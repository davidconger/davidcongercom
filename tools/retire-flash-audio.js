#!/usr/bin/env node
'use strict';

/*
 * retire-flash-audio.js
 *
 * radio/kiss.htm and radio/nk2.htm embed six Flash MP3 players. Every one of
 * them renders as an empty gap, and has done for years, for two independent
 * reasons:
 *
 *   1. The player itself is Flash, loaded from flash-mp3-player.net. Adobe ended
 *      Flash support on 31 December 2020 and no current browser will run a .swf.
 *
 *   2. The audio is hosted on kissdave.net, which no longer answers at all.
 *      DNS still resolves (162.222.214.126) but every connection times out, over
 *      both http and https, while a control request to davidconger.com returns
 *      200. The files are gone, not merely moved.
 *
 * Either fault alone would be enough. Together they mean there is nothing to
 * recover by converting the embeds to a native <audio> element - that would just
 * produce a visible but permanently broken player pointing at a dead host. So
 * the embeds are replaced with a short note, matching how the site already
 * handles photographs that no longer exist (see prune-missing-photos.js).
 *
 * The MP3 filenames and the aircheck dates are not reproduced on the page: a
 * list of recordings nobody can play is noise, and git holds the original markup
 * in full if the audio is ever recovered.
 *
 * radio/player/ is removed too. It holds a copy of the standalone Flash "Audio
 * Player" - player.swf and its audio-player.js loader - which no page in the
 * tree references at all.
 *
 *   node tools/retire-flash-audio.js            # dry run
 *   node tools/retire-flash-audio.js --apply
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APPLY = process.argv.includes('--apply');

const PAGES = ['radio/kiss.htm', 'radio/nk2.htm'];
const DEAD_PLAYER_DIR = 'radio/player';

const FLASH_EMBED = /<object type="application\/x-shockwave-flash"[\s\S]*?<\/object>/gi;
const NOTE = '<em>Audio no longer available.</em>';

let replaced = 0;

for (const rel of PAGES) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) {
    console.log('  ?  ' + rel + ' - not found');
    continue;
  }
  const before = fs.readFileSync(file, 'utf8');
  const found = (before.match(FLASH_EMBED) || []).length;
  if (!found) continue;

  const after = before.replace(FLASH_EMBED, NOTE);
  replaced += found;
  console.log('  ~  ' + rel + ' - ' + found + ' Flash player(s) replaced');
  if (APPLY) fs.writeFileSync(file, after);
}

/* The loader and the .swf it drives are referenced by nothing. */
const playerDir = path.join(ROOT, DEAD_PLAYER_DIR);
let removedFiles = 0;
if (fs.existsSync(playerDir)) {
  for (const name of fs.readdirSync(playerDir)) {
    console.log('  -  ' + DEAD_PLAYER_DIR + '/' + name + ' - unreferenced Flash player');
    removedFiles++;
    if (APPLY) fs.unlinkSync(path.join(playerDir, name));
  }
  if (APPLY) fs.rmdirSync(playerDir);
}

console.log(
  '\n' + (APPLY ? 'Applied' : 'Dry run') + ': ' +
  replaced + ' embeds replaced, ' + removedFiles + ' player files removed.'
);
if (!APPLY && (replaced || removedFiles)) console.log('Re-run with --apply to write.');
