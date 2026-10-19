#!/bin/bash
# Storage: this computer's models folder and more added on other drives. A model's files are in the first storage
# that has them; a download goes to the default unless told where; a drive not plugged in is not connected, its
# models remembered, and nothing is made where it was; a model's files move between storages; a storage holding
# models is not forgotten while plugged in.
set -euo pipefail
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
sed '/^paths "\$HOME"$/,$d' "${BACKEND:-$ROOT/bin/omarchy-local-ai}" >"$TMP/functions"
source "$TMP/functions"
paths "$TMP/home"
mkdir -p "$STATE" "$MODELS"
ok() { echo "ok - $1"; }
no() { echo "not ok - $1"; [[ -z ${2:-} ]] || echo "$2"; exit 1; }
status() { printf '%s\n' "$*" >>"$TMP/status"; }
say() { :; }

# a drive is a folder here: plugged in while it is there
DRIVE=$TMP/media/T7
mkdir -p "$DRIVE"
load_stores
[[ ${STORES[*]} == "$MODELS" && $STORE == "$MODELS" && $(store_name "$MODELS") == "this computer" ]] || no "this computer's folder alone, the default" "${STORES[*]}"
cmd_store add "$DRIVE"
S2=$DRIVE/local-ai-models
load_stores
[[ ${STORES[1]:-} == "$S2" && -d $S2 && $(store_name "$S2") == T7 ]] || no "an added drive keeps its models in a local-ai-models folder, named for it" "${STORES[*]} $(store_name "$S2")"
(cmd_store add "$DRIVE") 2>"$TMP/err" && no "added twice"
(cmd_store add "$S2/inner") 2>/dev/null && no "a storage inside another"
(cmd_store add "$TMP/missing") 2>/dev/null && no "a folder that is not there"
ok "store add: one local-ai-models folder a drive, named for it; never twice, nested or missing"

# where files are: the first storage with them, else the default, else where a download is told to go
w=$(jq -nc '{repository: "owner/model", revision: "0123456789abcdef0123456789abcdef01234567", layout: "dir", mountPath: "/models", dir: "", files: ""}')
[[ $(wpaths "$w" | cut -d'|' -f6) == "$MODELS/owner--model@0123456789ab" ]] || no "a missing folder goes to the default"
[[ $(TO=$S2; load_stores; wpaths "$w" | cut -d'|' -f6) == "$S2/owner--model@0123456789ab" ]] || no "a download told where goes there"
[[ $(TO=$TMP/elsewhere; load_stores; wpaths "$w" | cut -d'|' -f6) == "$MODELS/owner--model@0123456789ab" ]] || no "somewhere not a storage is ignored"
mkdir -p "$S2/owner--model@0123456789ab"
load_stores
[[ $(wpaths "$w" | cut -d'|' -f6) == "$S2/owner--model@0123456789ab" ]] || no "files on a drive are found there"
mkdir -p "$MODELS/owner--model@0123456789ab"
[[ $(wpaths "$w" | cut -d'|' -f6) == "$MODELS/owner--model@0123456789ab" ]] || no "this computer's copy comes first"
rmdir "$MODELS/owner--model@0123456789ab"
cmd_store default "$S2"
load_stores
[[ $STORE == "$S2" && $(jq -r .store "$STATE/settings.json") == "$S2" ]] || no "store default"
cmd_store default "$MODELS"
load_stores
[[ $STORE == "$MODELS" && $(jq -r '.store // "none"' "$STATE/settings.json") == none ]] || no "this computer as the default again"
ok "a model's files are in the first storage with them; a download goes to the default, or where it is told"

# what the snapshot says of each storage, and where each folder is
printf 'x%.0s' {1..2000} >"$S2/owner--model@0123456789ab/model.safetensors"
: >"$S2/owner--model@0123456789ab/.verified2"
h=$(host)
jq -e --arg a "$MODELS" --arg b "$S2" '.stores | length == 2 and .[0].path == $a and .[0].primary and .[0].default and .[0].name == "this computer"
  and .[1].path == $b and .[1].name == "T7" and .[1].connected and (.[1].default | not)' <<<"$h" >/dev/null || no "the storages" "$(jq -c .stores <<<"$h")"
jq -e '.at["owner--model@0123456789ab"] == 1 and (.have | index("owner--model@0123456789ab/.verified2")) != null' <<<"$h" >/dev/null ||
  no "a folder on the drive is found there and checked" "$(jq -c '{at, have}' <<<"$h")"
ok "the snapshot lists each storage (name, plugged in, free, default) and which one each folder is in"

# a drive unplugged: its models are remembered where they were put, nothing starts, downloads or is made there
placed owner--model@0123456789ab "$S2"
mv "$DRIVE" "$TMP/unplugged"
load_stores
h=$(host)
jq -e '(.stores[1].connected | not) and .at["owner--model@0123456789ab"] == 1 and (.have | length == 0)' <<<"$h" >/dev/null ||
  no "an unplugged drive's model is away" "$(jq -c '{stores, at, have}' <<<"$h")"
[[ $(wpaths "$w" | cut -d'|' -f6) == "$S2/owner--model@0123456789ab" ]] || no "an unplugged model is not downloaded again to the default"
(fetch m "$w") 2>"$TMP/err" && no "fetched to an unplugged drive"
grep -q 'T7 is not connected; plug it in' "$TMP/err" && [[ ! -e $DRIVE ]] || no "nothing is made where the drive was" "$(cat "$TMP/err")"
(cmd_store default "$S2") 2>/dev/null && no "an unplugged drive made the default"
mv "$TMP/unplugged" "$DRIVE"
ok "an unplugged drive: its models remembered on it, never downloaded again elsewhere, nothing made in its place"

# moving a model's files: copied, checked, the old ones gone, where they are recorded
RECIPES=$TMP/recipes.json
jq -n --argjson w "$w" '{hardware: {card: {recipes: [{id: "m", name: "M", weights: [$w]}]}}}' >"$RECIPES"
mkdir -p "$STATE/downloads/m"
(move_run m "$MODELS") 2>"$TMP/err" || no "move to this computer" "$(cat "$TMP/err")"
[[ -f $MODELS/owner--model@0123456789ab/model.safetensors && ! -e $S2/owner--model@0123456789ab && $(jq -c . "$STATE/placed.json") == '{}' ]] ||
  no "moved here, gone there, recorded" "$(ls -a "$MODELS" "$S2"; cat "$STATE/placed.json")"
[[ $(stat -c %s "$MODELS/owner--model@0123456789ab/model.safetensors") == 2000 && -f $MODELS/owner--model@0123456789ab/.verified2 ]] || no "the moved files"
mkdir -p "$STATE/downloads/m"
(move_run m "$S2") 2>"$TMP/err" || no "move to the drive" "$(cat "$TMP/err")"
[[ -f $S2/owner--model@0123456789ab/model.safetensors && ! -e $MODELS/owner--model@0123456789ab && $(jq -r '."owner--model@0123456789ab"' "$STATE/placed.json") == "$S2" ]] ||
  no "moved to the drive and recorded there"
! compgen -G "$S2/.moving.*" >/dev/null && ! compgen -G "$MODELS/.moving.*" >/dev/null || no "a half-made copy was left"
grep -q '^m download moving to T7' "$TMP/status" || no "a move says where it goes" "$(cat "$TMP/status")"
ok "a model's files move between storages: copied, checked, the old ones removed, where they went recorded"

# a storage is forgotten only once it holds none of its models, unless it is unplugged
(cmd_store remove "$S2") 2>"$TMP/err" && no "forgot a drive holding models"
grep -q 'T7 still holds models; move or remove them first' "$TMP/err" || no "why" "$(cat "$TMP/err")"
(cmd_store remove "$MODELS") 2>/dev/null && no "forgot this computer's folder"
mv "$DRIVE" "$TMP/unplugged"
cmd_store remove "$S2"
load_stores
[[ ${#STORES[@]} == 1 && $(jq -c . "$STATE/placed.json") == '{}' && -f $TMP/unplugged/local-ai-models/owner--model@0123456789ab/model.safetensors ]] ||
  no "an unplugged drive is forgotten with its record, its files left on it"
ok "a storage holding models is not forgotten while plugged in; an unplugged one is, its files left on the drive; this computer's never"

# this computer's folder is made on the first download, never refused as not connected
rm -rf "$MODELS"
(connected "$MODELS") || no "this computer's folder, not made yet, is connected"
ok "this computer's models folder counts as plugged in before it is made"
