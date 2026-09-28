# Practice word lists

`en.js` and `ru.js` contain the 5,000 most frequent words of each language, used by Typing Insights
to suggest practice words for slow or correction-prone key pairs.

- Source: [hermitdave/FrequencyWords](https://github.com/hermitdave/FrequencyWords), files
  `content/2018/en/en_50k.txt` and `content/2018/ru/ru_50k.txt`, generated from the
  OpenSubtitles 2018 corpus.
- Author: Hermit Dave.
- License of the word lists: [Creative Commons Attribution-ShareAlike 4.0 International
  (CC BY-SA 4.0)](https://creativecommons.org/licenses/by-sa/4.0/). The source repository's code is
  MIT licensed; its content is CC BY-SA 4.0.
- Changes: kept only lower-cased words of at least two letters from the language's alphabet
  (`a-z` for English, `а-яё` for Russian), removed duplicates, and truncated each list to the first
  5,000 entries in frequency order. Frequency counts were dropped.

The derived lists in `en.js` and `ru.js` are distributed under CC BY-SA 4.0. This license applies
only to these word-list files, not to the rest of Keyboard Helper.

Approved by the maintainer on 2026-09-28 for the `add-typing-insights-dashboard` change.
