export const READING_LANGUAGES = Object.freeze(["en", "ru"]);

const EN_LETTERS = Object.fromEntries(
  [..."abcdefghijklmnopqrstuvwxyz"].map((letter) => [`Key${letter.toUpperCase()}`, letter]),
);

// Russian ЙЦУКЕН letters on US QWERTY key codes as reported by system key events.
const RU_LETTERS = Object.freeze({
  KeyQ: "й", KeyW: "ц", KeyE: "у", KeyR: "к", KeyT: "е", KeyY: "н", KeyU: "г", KeyI: "ш", KeyO: "щ", KeyP: "з",
  LeftBracket: "х", RightBracket: "ъ",
  KeyA: "ф", KeyS: "ы", KeyD: "в", KeyF: "а", KeyG: "п", KeyH: "р", KeyJ: "о", KeyK: "л", KeyL: "д",
  SemiColon: "ж", Quote: "э",
  KeyZ: "я", KeyX: "ч", KeyC: "с", KeyV: "м", KeyB: "и", KeyN: "т", KeyM: "ь", Comma: "б", Dot: "ю",
  BackQuote: "ё",
});

export const KEY_LETTERS = Object.freeze({ en: Object.freeze(EN_LETTERS), ru: RU_LETTERS });

const MACOS_ENGLISH = /^com\.apple\.keylayout\.(US|ABC|British|Australian|Canadian|Irish|USExtended|USInternational-PC|Colemak|Dvorak)(?:$|[-.])/;
const MACOS_RUSSIAN = /^com\.apple\.keylayout\.Russian/;

/**
 * Maps a recorded analytics language/input-source identifier to a dictionary language.
 * Returns null when the source is unknown or not English or Russian.
 * @param {unknown} sourceId
 * @returns {"en" | "ru" | null}
 */
export function dictionaryLanguageForSource(sourceId) {
  if (typeof sourceId !== "string") return null;
  const id = sourceId.trim();
  if (!id || id === "unknown") return null;
  const xkb = /^xkb:layout:([a-z]+)(?::.*)?$/i.exec(id);
  if (xkb) {
    const layout = xkb[1].toLowerCase();
    if (layout === "us" || layout === "gb") return "en";
    if (layout === "ru") return "ru";
    return null;
  }
  const klid = /^windows:klid:([0-9A-Fa-f]{8})$/.exec(id);
  if (klid) {
    const primaryLanguage = Number.parseInt(klid[1].slice(4), 16) & 0x3ff;
    if (primaryLanguage === 0x09) return "en";
    if (primaryLanguage === 0x19) return "ru";
    return null;
  }
  if (MACOS_RUSSIAN.test(id)) return "ru";
  if (MACOS_ENGLISH.test(id)) return "en";
  return null;
}

/**
 * Returns the letter readings of a key-code pair, narrowed to one language when it is known.
 * @param {{ fromCode: string, toCode: string, language?: string }} pair
 */
export function pairReadings({ fromCode, toCode, language }) {
  const known = dictionaryLanguageForSource(language);
  const languages = known ? [known] : READING_LANGUAGES;
  return languages
    .map((lang) => {
      const first = KEY_LETTERS[lang][fromCode];
      const second = KEY_LETTERS[lang][toCode];
      return first && second ? { language: lang, letters: `${first}${second}` } : null;
    })
    .filter(Boolean);
}

/**
 * Picks frequency-ordered words containing the letter pair.
 * @param {readonly string[]} words
 * @param {string} letters
 * @param {number} [limit]
 */
export function practiceWords(words, letters, limit = 10) {
  const result = [];
  for (const word of words) {
    if (word.includes(letters)) result.push(word);
    if (result.length === limit) break;
  }
  return result;
}
