// CPU reference for the four cloth compute entry points. Read the production
// bindings and evaluate their WGSL expressions, including f32 arithmetic. This
// keeps a change to a shader constant, branch or dispatch visible to the tests.
import ts from 'typescript'

const f32 = Math.fround
const vector = Array.isArray
const binary = (op) =>
  function apply(a, b) {
    if (vector(a)) return a.map((x, i) => apply(x, vector(b) ? b[i] : b))
    if (vector(b)) return b.map((y) => apply(a, y))
    return f32(op(a, b))
  }
const add = binary((a, b) => a + b),
  sub = binary((a, b) => a - b)
const product = binary((a, b) => a * b),
  divide = binary((a, b) => a / b)
const dot = (a, b) => a.reduce((sum, x, i) => f32(sum + f32(x * b[i])), 0)
const length = (a) => f32(Math.sqrt(dot(a, a)))
function multiply(a, b) {
  if (vector(a) && vector(a[0])) {
    // Column-major mat4 times vec4.
    return a.map((_, i) =>
      dot(
        a.map((col) => col[i]),
        b,
      ),
    )
  }
  return product(a, b)
}
function vec(size, values) {
  const flat = values.flat()
  return flat.length === 1 ? Array(size).fill(flat[0]) : flat
}
const math = {
  add,
  sub,
  multiply,
  divide,
  dot,
  length,
  f32,
  abs: Math.abs,
  max: Math.max,
  min: Math.min,
  pow: (x, y) => f32(x ** y),
  select: (a, b, condition) => (condition ? b : a),
  clamp: (x, lo, hi) => Math.min(hi, Math.max(lo, x)),
  mix: (a, b, t) => add(product(a, f32(1 - t)), product(b, t)),
  normalize: (a) => divide(a, length(a)),
  cross: (a, b) =>
    [0, 1, 2].map((i) => f32(a[(i + 1) % 3] * b[(i + 2) % 3] - a[(i + 2) % 3] * b[(i + 1) % 3])),
  transpose: (m) => m.map((_, i) => m.map((col) => col[i])),
  vec3f: (...v) => vec(3, v),
  vec4f: (...v) => vec(4, v),
}
const names = ['p', 'nodes', 'poses', 'bones', 'meshes', 'edges', 'batch', 'capsules', 'clearance', 'offsets']
const operators = { '+': 'add', '-': 'sub', '*': 'multiply', '/': 'divide' }
const printer = ts.createPrinter()
function compile(code, entry) {
  // The kernel bodies use C-style statements. Translate only their vector
  // operators and swizzles; control flow and buffer indices run as written.
  const match = code.match(new RegExp('fn ' + entry + '\\([^\\n]+\\{([\\s\\S]*?)\\n\\}'))
  if (!match) throw Error('Missing cloth kernel ' + entry)
  const body = match[1].replace(/\b(\d+)u\b/g, '$1').replace(/\bvar\b/g, 'let')
  const file = ts.createSourceFile(entry + '.js', body, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS)
  const transformed = ts.transform(file, [
    (ctx) => (root) => {
      const f = ctx.factory
      const call = (name, args) => f.createCallExpression(f.createIdentifier(name), undefined, args)
      function visit(node) {
        const n = ts.visitEachChild(node, visit, ctx)
        if (
          ts.isVariableDeclaration(n) &&
          n.initializer &&
          ts.isElementAccessExpression(n.initializer) &&
          ['poses', 'edges'].includes(n.initializer.expression.getText(file))
        ) {
          // A WGSL let binding copies its struct. Vector operations below return fresh values.
          return f.updateVariableDeclaration(
            n,
            n.name,
            undefined,
            undefined,
            f.createObjectLiteralExpression([f.createSpreadAssignment(n.initializer)]),
          )
        }
        if (ts.isPropertyAccessExpression(n)) {
          const key = n.name.text
          if ('xyzw'.includes(key) && key.length === 1)
            return f.createElementAccessExpression(n.expression, 'xyzw'.indexOf(key))
          if (key === 'xyz')
            return f.createCallExpression(
              f.createPropertyAccessExpression(n.expression, 'slice'),
              undefined,
              [f.createNumericLiteral(0), f.createNumericLiteral(3)],
            )
        }
        if (ts.isBinaryExpression(n)) {
          const op = ts.tokenToString(n.operatorToken.kind)
          if (operators[op]) return call(operators[op], [n.left, n.right])
          if (op.endsWith('=') && operators[op.slice(0, -1)])
            return f.createAssignment(n.left, call(operators[op.slice(0, -1)], [n.left, n.right]))
        }
        return n
      }
      return ts.visitNode(root, visit)
    },
  ])
  const source = printer.printFile(transformed.transformed[0])
  transformed.dispose()
  return new Function(...Object.keys(math), 'return function(' + names + ',gid){' + source + '}')(
    ...Object.values(math),
  )
}

const list = (count, read) => Array.from({ length: count }, (_, i) => read(i))
function decode(label, bytes) {
  const f = new Float32Array(bytes.buffer),
    u = new Uint32Array(bytes.buffer)
  const v = (at, n = 3) => Array.from(f.subarray(at, at + n))
  const mat = (at) => list(4, (j) => v(at + 4 * j, 4))
  switch (label) {
    case 'cloth parameters':
      return {
        count: u[0],
        shapes: u[1],
        bodyCount: u[2],
        dynamic: u[3],
        dt: f[4],
        scale: f[5],
        retention: f[6],
        stiffness: f[7],
        initialized: u[8],
        floorOrigin: v(12),
        tether: f[15],
        up: v(16),
        thickness: f[19],
        stage: mat(20),
        inverseStage: mat(36),
      }
    case 'cloth skin':
      return list(f.length / 16, (i) => {
        const k = i * 16
        return {
          position: v(k),
          mobility: f[k + 3],
          joints: Array.from(u.subarray(k + 4, k + 8)),
          weights: v(k + 8, 4),
          mesh: u[k + 12],
          mask: u[k + 13],
          floorHeight: f[k + 14],
          skirt: u[k + 15],
        }
      })
    case 'cloth positions':
      return list(bytes.length / 80, () => ({
        curr: [0, 0, 0],
        prev: [0, 0, 0],
        pred: [0, 0, 0],
        skin: [0, 0, 0],
        contact: [0, 0, 0],
      }))
    case 'cloth bones':
      return list(f.length / 16, (i) => mat(i * 16))
    case 'cloth mesh frames':
      return list(f.length / 64, (i) => ({
        bind: mat(i * 64),
        inverseBind: mat(i * 64 + 16),
        world: mat(i * 64 + 32),
        inverseWorld: mat(i * 64 + 48),
      }))
    case 'cloth edges':
      return list(f.length / 8, (i) => ({
        a: u[i * 8],
        b: u[i * 8 + 1],
        compliance: f[i * 8 + 2],
        lambda: f[i * 8 + 3],
        bindDirection: v(i * 8 + 4),
        restLength: f[i * 8 + 7],
      }))
    case 'cloth capsules':
      return list(f.length / 12, (i) => ({
        aRadius: v(i * 12, 4),
        bScale: v(i * 12 + 4, 4),
        mask: u[i * 12 + 8],
        stageMetric: u[i * 12 + 9],
        localRadius: f[i * 12 + 10],
        localScale: f[i * 12 + 11],
      }))
    default:
      return f
  }
}

export function cpuClothDevice() {
  return {
    createShaderModule: ({ code }) => code,
    createComputePipeline: ({ compute }) => ({
      run: compile(compute.module, compute.entryPoint),
      getBindGroupLayout: () => compute.entryPoint,
    }),
    createBuffer({ label, size }) {
      const bytes = new Uint8Array(size)
      return {
        bytes,
        label,
        data: decode(label, bytes),
        mapAsync: async () => {},
        getMappedRange: () => bytes.buffer,
        unmap() {},
        destroy() {},
      }
    },
    createBindGroup: ({ entries }) => entries,
    queue: {
      writeBuffer(buffer, at, data) {
        buffer.bytes.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength), at)
        buffer.data = decode(buffer.label, buffer.bytes)
      },
      submit() {},
    },
    createCommandEncoder() {
      return {
        beginComputePass() {
          let program, inputs
          return {
            setPipeline(p) {
              program = p.run
            },
            setBindGroup(_, entries) {
              inputs = Array(names.length)
              for (const { binding, resource } of entries) {
                inputs[binding] =
                  binding === 6
                    ? new Uint32Array(resource.buffer.bytes.buffer, resource.offset, 4)
                    : resource.buffer.data
              }
            },
            dispatchWorkgroups(blocks) {
              // Each edge batch is vertex-disjoint. Sequential invocations implement
              // the same read/write ordering as the production color dispatch.
              for (let i = 0; i < blocks * 64; i++) program(...inputs, [i, 0, 0])
            },
            end() {},
          }
        },
        copyBufferToBuffer(src, from, dst, to, size) {
          dst.bytes.set(src.bytes.subarray(from, from + size), to)
        },
        finish() {
          return {}
        },
      }
    },
  }
}
