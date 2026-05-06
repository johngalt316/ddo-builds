#!/usr/bin/env node
// One-off: dump every sheet of an xlsx file as CSV to stdout, separated
// by `=== <SheetName> ===` markers. Used to inspect the Arcane Trickster
// DPS reference spreadsheet without committing xlsx tooling to the repo.

import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';

const path = process.argv[2];
if (!path) {
  console.error('usage: node scripts/dumpXlsx.mjs <path-to-xlsx>');
  process.exit(1);
}

const wb = XLSX.read(readFileSync(path), { type: 'buffer', cellFormula: true });
for (const name of wb.SheetNames) {
  console.log(`\n=== ${name} ===`);
  const sheet = wb.Sheets[name];
  const csv   = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
  console.log(csv);
}
