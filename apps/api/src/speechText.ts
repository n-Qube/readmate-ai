import type { TargetLanguage } from "./localLanguage.js";

type PronunciationDictionary = Partial<Record<TargetLanguage | "all", Record<string, string>>>;

const COMMON_ABBREVIATIONS: Record<string, string> = {
  "dr.": "Doctor",
  "mr.": "Mister",
  "mrs.": "Missus",
  "ms.": "Miss",
  "prof.": "Professor",
  "rev.": "Reverend",
  "hon.": "Honourable",
  "st.": "Saint",
  "rd.": "Road",
  "ave.": "Avenue",
  "dept.": "Department",
  "govt.": "government",
  "no.": "number",
  "etc.": "et cetera",
  "e.g.": "for example",
  "i.e.": "that is"
};

const BUILT_IN_PRONUNCIATIONS: PronunciationDictionary = {
  all: {
    "Akufo-Addo": "Ah koo fo Ah doh",
    Agyeman: "Ah jeh man",
    Kufuor: "Koo four",
    Nkrumah: "En kru mah",
    Mahama: "Mah hah mah",
    Ghana: "Gah nah",
    Accra: "Ah krah",
    Khaya: "Kah yah",
    ReadMate: "Read Mate"
  },
  tw: { Twi: "Chwee" },
  ee: { Ewe: "Eh veh" },
  gaa: { Ga: "Gah" }
};

export function normalizeSpeechInput(text: string): string {
  let value = text.normalize("NFKC");
  value = value.replace(/https?:\/\/[^\s<>()]+/gi, speakableUrl);
  value = value.replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, speakableEmail);
  value = replaceAbbreviations(value);
  value = value
    .replace(/£\s?(\d[\d,.]*)/g, "$1 pounds")
    .replace(/\$\s?(\d[\d,.]*)/g, "$1 dollars")
    .replace(/GH₵\s?(\d[\d,.]*)/gi, "$1 Ghana cedis")
    .replace(/₵\s?(\d[\d,.]*)/g, "$1 Ghana pesewas")
    .replace(/(\d[\d,.]*)\s?%/g, "$1 percent")
    .replace(/\b(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d+))?\b/g, (_match, integer: string, decimal?: string) => {
      const spokenInteger = integer.replace(/,/g, "");
      const parsed = Number(spokenInteger);
      if (!Number.isSafeInteger(parsed) || parsed > 999_999_999_999_999) return _match;
      const whole = integerToWords(parsed);
      return decimal ? `${whole} point ${decimal.split("").map(digitWord).join(" ")}` : whole;
    });
  return normalizePunctuation(value);
}

export function prepareTranslatedSpeech(text: string, targetLanguage: Exclude<TargetLanguage, "en">): string {
  return applyPronunciationDictionary(normalizePunctuation(text), targetLanguage);
}

export function splitSpeechSections(text: string, maxCharacters = 600): string[] {
  const normalized = normalizePunctuation(text);
  if (!normalized) return [];
  const sentences = normalized.match(/[^.!?。！？]+(?:[.!?。！？]+|$)/g)?.map((part) => part.trim()).filter(Boolean) ?? [normalized];
  const sections: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    for (const part of splitOversizedSentence(sentence, maxCharacters)) {
      const candidate = current ? `${current} ${part}` : part;
      if (candidate.length <= maxCharacters) {
        current = candidate;
      } else {
        if (current) sections.push(current);
        current = part;
      }
    }
  }
  if (current) sections.push(current);
  return sections;
}

export function applyPronunciationDictionary(
  text: string,
  targetLanguage: Exclude<TargetLanguage, "en">,
  customDictionary = pronunciationDictionaryFromEnv()
): string {
  const entries = {
    ...BUILT_IN_PRONUNCIATIONS.all,
    ...BUILT_IN_PRONUNCIATIONS[targetLanguage],
    ...customDictionary.all,
    ...customDictionary[targetLanguage]
  };
  let output = text;
  for (const [name, pronunciation] of Object.entries(entries)) {
    if (!name.trim() || !pronunciation.trim()) continue;
    output = output.replace(new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(name)}(?=$|[^\\p{L}\\p{N}])`, "giu"), (_match, prefix: string) => `${prefix}${pronunciation}`);
  }
  return output;
}

function pronunciationDictionaryFromEnv(): PronunciationDictionary {
  const raw = process.env.PRONUNCIATION_DICTIONARY_JSON?.trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const dictionary: PronunciationDictionary = {};
    for (const language of ["all", "en", "tw", "ee", "gaa"] as const) {
      const candidates = (parsed as Record<string, unknown>)[language];
      if (!candidates || typeof candidates !== "object" || Array.isArray(candidates)) continue;
      dictionary[language] = Object.fromEntries(
        Object.entries(candidates)
          .filter((entry): entry is [string, string] => typeof entry[1] === "string")
          .map(([name, pronunciation]) => [name.trim(), pronunciation.trim()])
          .filter(([name, pronunciation]) => Boolean(name && pronunciation))
      );
    }
    return dictionary;
  } catch {
    return {};
  }
}

function replaceAbbreviations(text: string): string {
  let output = text;
  for (const [abbreviation, spoken] of Object.entries(COMMON_ABBREVIATIONS)) {
    output = output.replace(new RegExp(`(^|\\s)${escapeRegExp(abbreviation)}(?=\\s|$)`, "gi"), (_match, prefix: string) => `${prefix}${spoken}`);
  }
  return output.replace(/\b(?:AI|API|BBC|CNN|ECG|GDP|GPS|HTML|ICT|PDF|RSS|TTS|UK|UN|URL|USA|WHO)\b/g, (value) => value.split("").join(" "));
}

function speakableUrl(value: string): string {
  try {
    const url = new URL(value.replace(/[.,;:!?]+$/, ""));
    const host = url.hostname.replace(/^www\./i, "").split(".").join(" dot ");
    const path = decodeURIComponent(url.pathname)
      .split("/")
      .filter(Boolean)
      .map((part) => part.replace(/[-_]+/g, " "))
      .join(" slash ");
    return path ? `${host} slash ${path}` : host;
  } catch {
    return value;
  }
}

function speakableEmail(value: string): string {
  return value.replace("@", " at ").replace(/\./g, " dot ").replace(/[-_]+/g, " ");
}

function normalizePunctuation(value: string): string {
  return value
    .replace(/[“”„]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, ", ")
    .replace(/…+/g, ". ")
    .replace(/[•·]/g, ". ")
    .replace(/\s*([,;:.!?])\s*/g, "$1 ")
    .replace(/([!?]){2,}/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function splitOversizedSentence(sentence: string, maxCharacters: number): string[] {
  if (sentence.length <= maxCharacters) return [sentence];
  const clauses = sentence.split(/(?<=[,;:])\s+/).filter(Boolean);
  if (clauses.length > 1) {
    const output: string[] = [];
    let current = "";
    for (const clause of clauses) {
      const candidate = current ? `${current} ${clause}` : clause;
      if (candidate.length <= maxCharacters) current = candidate;
      else {
        if (current) output.push(current);
        if (clause.length > maxCharacters) output.push(...splitByWords(clause, maxCharacters));
        else current = clause;
      }
    }
    if (current) output.push(current);
    return output;
  }
  return splitByWords(sentence, maxCharacters);
}

function splitByWords(text: string, maxCharacters: number): string[] {
  const output: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/)) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharacters) current = candidate;
    else {
      if (current) output.push(current);
      if (word.length > maxCharacters) {
        for (let offset = 0; offset < word.length; offset += maxCharacters) output.push(word.slice(offset, offset + maxCharacters));
        current = "";
      } else current = word;
    }
  }
  if (current) output.push(current);
  return output;
}

function integerToWords(value: number): string {
  if (value === 0) return "zero";
  const scales = [
    [1_000_000_000_000, "trillion"],
    [1_000_000_000, "billion"],
    [1_000_000, "million"],
    [1_000, "thousand"]
  ] as const;
  const words: string[] = [];
  let remainder = value;
  for (const [size, name] of scales) {
    if (remainder < size) continue;
    const count = Math.floor(remainder / size);
    words.push(integerBelowThousand(count), name);
    remainder %= size;
  }
  if (remainder) words.push(integerBelowThousand(remainder));
  return words.join(" ");
}

function integerBelowThousand(value: number): string {
  const small = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
  const tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
  const words: string[] = [];
  let remainder = value;
  if (remainder >= 100) {
    words.push(small[Math.floor(remainder / 100)], "hundred");
    remainder %= 100;
  }
  if (remainder >= 20) {
    words.push(tens[Math.floor(remainder / 10)]);
    remainder %= 10;
  }
  if (remainder) words.push(small[remainder]);
  return words.join(" ");
}

function digitWord(value: string): string {
  return ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"][Number(value)] ?? value;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const __speechTextInternals = { pronunciationDictionaryFromEnv, integerToWords, speakableUrl };
