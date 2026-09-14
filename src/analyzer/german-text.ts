/** Bounded German lexical rules: no guessed compound splitting or translation. */
export const GERMAN_STOP_WORDS = new Set(
  'aber als am an auch auf aus bei bis damit dass das dem den der des die doch durch ein eine einem einen einer eines für fuer gegen im ins ist mit nach ob oder seit sich sind über ueber um und unter vom von vor während waehrend zum zur zwischen ich mich mir mein meine meinen meiner wir uns unser unsere sie ihr ihre ihren ihnen'.split(
    ' ',
  ),
);

export const GERMAN_GOAL_FILLERS = new Set(
  'ich mich mir mein meine meinen meiner möchte moechte will wollen suche suchen lernen verstehen wissen können koennen soll sollen nützlich nuetzlich hilfreich aktuell aktuelle aktuellen artikel thema themen ziel ziele'.split(
    ' ',
  ),
);

// Only recognized word families are reduced. Applying a generic German
// suffix stripper to English profiles would corrupt words such as "other".
const families: Array<[RegExp, string]> = [
  [/^vergleich(?:e|en|s|st|t)?$/u, 'vergleich'],
  [/^bewert(?:en|e|et|ete|eten|ung|ungen)$/u, 'bewertung'],
  [/^prüf(?:en|e|t|te|ten|ung|ungen)$/u, 'prüfung'],
  [/^überprüf(?:en|e|t|ung|ungen)$/u, 'prüfung'],
  [/^mess(?:en|e|ung|ungen)$/u, 'messung'],
  [/^untersuch(?:en|e|t|ung|ungen)$/u, 'untersuchung'],
  [/^entscheid(?:en|e|et|ung|ungen)$/u, 'entscheidung'],
  [/^empfehl(?:en|ung|ungen)$/u, 'empfehlung'],
  [/^entwickl(?:en|ung|ungen)$/u, 'entwicklung'],
  [/^entwickel(?:n|t)$/u, 'entwicklung'],
  [/^erklär(?:en|e|t|ung|ungen)$/u, 'erklärung'],
  [/^begrenz(?:en|t|ung|ungen)$/u, 'begrenzung'],
  [/^einschränk(?:en|t|ung|ungen)$/u, 'einschränkung'],
  [/^anwend(?:en|ung|ungen)$/u, 'anwendung'],
  [/^verbesser(?:n|t|ung|ungen)$/u, 'verbesserung'],
  [/^modell(?:e|en|s)?$/u, 'modell'],
  [/^sprachmodell(?:e|en|s)?$/u, 'sprachmodell'],
  [/^modellbewertung(?:en)?$/u, 'modellbewertung'],
  [/^modellevaluation(?:en)?$/u, 'modellevaluation'],
  [/^modellfehler(?:n|s)?$/u, 'modellfehler'],
  [/^modelltests?$/u, 'modelltests'],
  [/^halluzination(?:en)?$/u, 'halluzinationen'],
  [/^antwort(?:en)?$/u, 'antwort'],
  [/^fehler(?:n|s)?$/u, 'fehler'],
  [/^beispiel(?:e|en|s)?$/u, 'beispiel'],
  [/^ergebnis(?:se|sen|ses)?$/u, 'ergebnis'],
  [/^methode(?:n)?$/u, 'methode'],
  [/^verfahren(?:s)?$/u, 'verfahren'],
  [/^quelle(?:n)?$/u, 'quelle'],
  [/^studie(?:n)?$/u, 'studie'],
  [/^stichprobe(?:n)?$/u, 'stichprobe'],
  [/^schritt(?:e|en|s)?$/u, 'schritt'],
  [/^datens(?:atz|atzes|ätze|ätzen)$/u, 'datensatz'],
  [/^kriteri(?:um|ums|en)$/u, 'kriterium'],
  [/^bedingung(?:en)?$/u, 'bedingung'],
  [/^ausnahme(?:n)?$/u, 'ausnahme'],
  [/^aufgabe(?:n)?$/u, 'aufgabe'],
  [/^werkzeug(?:e|en|s)?$/u, 'werkzeug'],
  [/^kenntnis(?:se|sen)?$/u, 'kenntnis'],
  [/^fähigkeit(?:en)?$/u, 'fähigkeit'],
  [/^bewerbung(?:en)?$/u, 'bewerbung'],
  [/^unternehmen(?:s)?$/u, 'unternehmen'],
  [/^kosten$/u, 'kosten'],
  [/^risik(?:o|os|en)$/u, 'risiko'],
  [/^vertrag(?:s)?$|^verträge(?:n)?$/u, 'vertrag'],
  [/^rendite(?:n)?$/u, 'rendite'],
  [/^zinsen?$/u, 'zins'],
  [/^investition(?:en)?$/u, 'investition'],
  [/^klimamodelle?(?:n|s)?$/u, 'klimamodell'],
  [/^behandlung(?:en)?$/u, 'behandlung'],
  [/^nebenwirkung(?:en)?$/u, 'nebenwirkung'],
  [/^rezept(?:e|en|s)?$/u, 'rezept'],
  [/^zutat(?:en)?$/u, 'zutat'],
  [/^künstlich(?:e|en|er|es|em)?$/u, 'künstlich'],
  [/^maschinell(?:e|en|er|es|em)?$/u, 'maschinell'],
  [/^zuverlässig(?:e|en|er|es|em)?$/u, 'zuverlässig'],
  [/^wissenschaftlich(?:e|en|er|es|em)?$/u, 'wissenschaftlich'],
];

export function germanLemma(word: string): string {
  // Standard spelling and keyboard transliteration share the same entries.
  const normalized = word
    .replace(/ue/gu, 'ü')
    .replace(/oe/gu, 'ö')
    .replace(/ae/gu, 'ä');
  for (const [pattern, lemma] of families)
    if (pattern.test(normalized)) return lemma;
  return word;
}

export const GERMAN_PRACTICAL_MARKERS =
  /(?<![\p{L}\p{N}])(?:vergleich\p{L}*|bewert\p{L}*|prüf\p{L}*|überprüf\p{L}*|mess\p{L}*|konfigurier\p{L}*|einricht\p{L}*|test\p{L}*|beispiel\p{L}*|schritt\p{L}*|weil|jedoch|allerdings|einschränkung\p{L}*|ausnahme\p{L}*)(?![\p{L}\p{N}])/iu;
