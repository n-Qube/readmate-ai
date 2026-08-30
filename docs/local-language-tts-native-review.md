# ReadMate local-language TTS native-speaker review

Use this pack before approving a Twi, Ewe, or Ga voice for production. Each language needs at least two native speakers. Reviewers should not see another reviewer's scores until they finish.

## How to test

1. Select the target language and speaker in **Settings → Voice & playback**.
2. Play each passage below in full. Do not score from text alone.
3. Score translation accuracy, pronunciation, naturalness, pacing, and overall listening quality from 1 (unusable) to 5 (excellent).
4. Copy the exact incorrect word or phrase and write the preferred wording or pronunciation.
5. Record the language, variety/dialect, speaker ID, app build, reviewer initials, and date.

A voice is ready only when the median overall score is at least 4, no passage has a median translation score below 3, and every repeated name error has a pronunciation-dictionary entry or a documented provider limitation.

## Twelve required passages

1. **Greeting:** “Good morning. Welcome to ReadMate. Today we will listen, learn, and continue where you stopped.”
2. **Names:** “Kwame Nkrumah addressed the audience in Accra, while Nana Akufo-Addo and John Mahama attended the ceremony.”
3. **Numbers and money:** “The project trained 1,250 students, reached 87.5 percent of its goal, and cost 42,600 Ghana cedis.”
4. **Date and time:** “The meeting starts at 8:30 a.m. on Thursday, 17 September 2026, and ends at 11:45 a.m.”
5. **Abbreviations:** “Dr. Mensah shared a PDF from the WHO and asked the ICT team to update the API and RSS feed.”
6. **Web address:** “Visit https://readmate.ai/help, or email support@readmate.ai for assistance.”
7. **Public service:** “The Electricity Company of Ghana says power will be restored after technicians complete the safety inspection.”
8. **Education:** “Photosynthesis allows green plants to turn light energy, water, and carbon dioxide into food and oxygen.”
9. **News sentence:** “Parliament approved the proposal after a long debate, but the committee requested another financial review.”
10. **Punctuation and quotation:** “Ama asked, ‘Are we ready?’ Kojo replied, ‘Yes—but let us check the figures once more.’”
11. **Long sentence:** “Although the road was flooded after the overnight rain, the medical team reached the village, delivered the supplies, and returned safely before sunset.”
12. **Mixed names:** “Kofi Annan met representatives from Microsoft, UNESCO, and the University of Ghana to discuss digital education.”

Add 3–8 passages from real ReadMate documents that reflect the reviewer’s dialect and everyday listening habits. This brings each language review to the recommended 15–20 passages.

## Review record

| Field | Value |
|---|---|
| Language and dialect | |
| Speaker ID | |
| Reviewer initials | |
| App build | |
| Date | |

| Passage | Translation 1–5 | Pronunciation 1–5 | Naturalness 1–5 | Pacing 1–5 | Overall 1–5 | Incorrect wording or pronunciation | Preferred correction |
|---:|---:|---:|---:|---:|---:|---|---|
| 1 | | | | | | | |
| 2 | | | | | | | |
| 3 | | | | | | | |
| 4 | | | | | | | |
| 5 | | | | | | | |
| 6 | | | | | | | |
| 7 | | | | | | | |
| 8 | | | | | | | |
| 9 | | | | | | | |
| 10 | | | | | | | |
| 11 | | | | | | | |
| 12 | | | | | | | |
| 13 | | | | | | | |
| 14 | | | | | | | |
| 15 | | | | | | | |

## Reporting corrections

- Translation problem: provide the source sentence, generated wording, and preferred native wording.
- Pronunciation problem: provide the exact written token and an easy-to-read phonetic replacement.
- Voice problem: note speaker ID, distortion type, timestamp, device model, and whether headphones were used.
- Pacing problem: identify the sentence boundary where the pause is missing or too long.

Approved corrections can be added to `PRONUNCIATION_DICTIONARY_JSON` using this structure:

```json
{
  "all": { "Recurring name": "phonetic spelling" },
  "tw": { "Twi-specific token": "phonetic spelling" },
  "ee": { "Ewe-specific token": "phonetic spelling" },
  "gaa": { "Ga-specific token": "phonetic spelling" }
}
```
