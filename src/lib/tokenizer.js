// CLIP BPE tokenizer (openai/clip-vit-base-patch32), matching the tokenizer.json rules:
// NFC, collapse whitespace, lowercase, CLIP split regex, byte-level, BPE with "</w>".

const SPLIT = /<\|startoftext\|>|<\|endoftext\|>|'s|'t|'re|'ve|'m|'ll|'d|[\p{L}]+|[\p{N}]|[^\s\p{L}\p{N}]+/gu;

function bytesToUnicode() {
  const bs = [];
  for (let i = 33; i <= 126; i++) bs.push(i);
  for (let i = 161; i <= 172; i++) bs.push(i);
  for (let i = 174; i <= 255; i++) bs.push(i);
  const cs = [...bs];
  let n = 0;
  for (let b = 0; b < 256; b++) {
    if (!bs.includes(b)) {
      bs.push(b);
      cs.push(256 + n);
      n++;
    }
  }
  const map = new Map();
  bs.forEach((b, i) => map.set(b, String.fromCharCode(cs[i])));
  return map;
}

export class ClipTokenizer {
  /** @param {any} json parsed tokenizer.json */
  constructor(json) {
    this.vocab = json.model.vocab;
    this.ranks = new Map(json.model.merges.map((m, i) => [typeof m === "string" ? m : m.join(" "), i]));
    this.byteMap = bytesToUnicode();
    this.encoder = new TextEncoder();
    this.cache = new Map();
    this.bos = this.vocab["<|startoftext|>"];
    this.eos = this.vocab["<|endoftext|>"];
  }

  bpe(token) {
    const cached = this.cache.get(token);
    if (cached) return cached;
    let word = [...token];
    word[word.length - 1] += "</w>";
    while (word.length > 1) {
      let best = -1;
      let bestRank = Infinity;
      for (let i = 0; i < word.length - 1; i++) {
        const r = this.ranks.get(word[i] + " " + word[i + 1]);
        if (r !== undefined && r < bestRank) {
          bestRank = r;
          best = i;
        }
      }
      if (best < 0) break;
      const a = word[best];
      const b = word[best + 1];
      const next = [];
      for (let i = 0; i < word.length; i++) {
        if (i < word.length - 1 && word[i] === a && word[i + 1] === b) {
          next.push(a + b);
          i++;
        } else next.push(word[i]);
      }
      word = next;
    }
    this.cache.set(token, word);
    return word;
  }

  /** Token ids with BOS/EOS, like the HF tokenizer with add_special_tokens. */
  encode(text) {
    const norm = text.normalize("NFC").replace(/\s+/g, " ").toLowerCase();
    const ids = [this.bos];
    for (const m of norm.matchAll(SPLIT)) {
      const bytes = this.encoder.encode(m[0]);
      const mapped = Array.from(bytes, (b) => this.byteMap.get(b)).join("");
      for (const piece of this.bpe(mapped)) {
        const id = this.vocab[piece];
        if (id !== undefined) ids.push(id);
      }
    }
    ids.push(this.eos);
    return ids;
  }

  /** Fixed-length ids for the text encoder: pad with EOS, keep the final EOS when truncating. */
  encodeFixed(text, len) {
    let ids = this.encode(text);
    if (ids.length > len) ids = [...ids.slice(0, len - 1), this.eos];
    const out = new Array(len).fill(this.eos);
    ids.forEach((id, i) => (out[i] = id));
    return out;
  }
}
