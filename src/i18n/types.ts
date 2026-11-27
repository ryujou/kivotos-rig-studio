export const languages = ['zh', 'ja', 'ko', 'en'] as const
export type Language = typeof languages[number]
export type Localized = Record<Language, string>
export const localized = (zh: string, ja: string, ko: string, en: string): Localized => ({ zh, ja, ko, en })
