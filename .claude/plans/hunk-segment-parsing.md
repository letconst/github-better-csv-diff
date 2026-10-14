# Parse each diff hunk as its own CSV segment (#68)

## Context

`diffToCsv` collects the visible lines of every hunk into one text per side and
hands it to `parseCsvWithLineMap`. A quoted multiline field that is still open
on the last visible line of a hunk has its closing quote in the collapsed
region, so Papa keeps consuming the next hunk's lines as part of that field and
the next hunk's rows vanish into one cell.

#55 is the mirror case (a hunk that starts inside a quoted record) and is out
of scope; it needs file content that is not in the DOM. This change only stops
one hunk from bleeding into the next.

## Decisions

- Boundary signal: a discontinuity in the physical line numbers that
  `parseCsvWithLineMap` already receives, not the `HunkEntry` items. Within one
  hunk each side's line numbers are consecutive, so a jump is exactly a hunk
  boundary, independent of whether GitHub rendered an expand control (the DOM
  extractor drops hunk rows without expanders). `diffToCsv`, the row matcher
  and the DOM layer stay untouched.
- Null line numbers: an "expected" counter advances by one on every line,
  numbered or not; only a numbered line that differs from the counter starts a
  new segment. `10, null, 12` stays one segment.
- Delimiter: Papa guesses the delimiter per parse call, and a short segment
  alone can guess wrong (`2,a;b;c` reads as semicolon-separated). Guess per
  segment and share the first detectable guess with every segment. A guess on
  the joined text fails when a segment ends inside an open quote, because the
  open field hides every delimiter after it. If no segment is detectable, the
  first guess's delimiter is used and its Delimiter error is warned once.
- `MissingQuotes` from a cut fragment is still reported via `console.warn`.
  Truncation cannot be told apart from malformed CSV, so suppressing it would
  hide real errors. Errors from all segments are collected into one warning.
- The zero-row fallback (reparse without `step`, null line numbers) applies to
  the combined result only, as before.
- No E2E: the change is confined to the parser and the DOM layer is unchanged.

## Tests

- `diffParser.test.ts`: #68 spec (the next hunk's rows survive an open quote at
  the previous hunk's end) and a `characterization:` test pinning the cut
  fragment's shape (mirror of the #55 test).
- `csvParser.test.ts`: null line numbers do not split a segment; one shared
  delimiter applies to a segment that would guess differently on its own; the
  delimiter comes from a later segment when an earlier one ends inside an open
  quote.

## Sample data

`example/large-file.csv` on `main` and PR #2: R033 is a quoted multiline record
whose first line is the last context line of the first hunk, so the closing
quote sits in the collapsed region. Line numbers after it shift by one.

## Out of scope

- #55, and its mirror (recovering the hidden tail of a cut record): both need
  fetching file content around the hunk.
