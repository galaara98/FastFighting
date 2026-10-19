/**
 * The review ledger's shared pieces (tools/review): fingerprints, the names a script uses, one entry per line, and the
 * comparisons and report a helper's check is made of. The data here is made up for the tests.
 */
import { describe, expect, test } from "vitest";
import {
  normalize, maskNumbers, withoutKeys, fingerprint, setPrint, printsPrint, namesIn, whereNamed, codeLink, linesJSON, compareVersions, stamp,
  compareSpecial, compareGeneric, compareNamed, newerThan, buildReport, issueBody, issueTitle, code, plain
} from "../tools/review/index.mjs";

describe("fingerprints", () => {
  test("normalized: keys sorted, white space collapsed, empty things dropped", () => {
    expect(normalize({ b: " two  words ", a: [], c: null, d: {}, e: [1, null, "x"], f: false })).toEqual({ b: "two words", e: [1, "x"], f: false });
    expect(fingerprint({ a: 1, b: [2] })).toBe(fingerprint({ b: [2], a: 1, c: undefined, d: [] }));
    expect(fingerprint({ a: 1 })).not.toBe(fingerprint({ a: 2 }));
    expect(fingerprint("x")).toMatch(/^[0-9a-f]{12}$/);
  });

  test("numbers masked, keys dropped", () => {
    expect(maskNumbers({ dc: 24, label: "frightened 2", parts: [{ n: 2, type: "fire" }] })).toEqual({ dc: "#", label: "frightened #", parts: [{ n: "#", type: "fire" }] });
    expect(withoutKeys({ id: "a.1", save: { type: "will", id: "x" } }, ["id"])).toEqual({ save: { type: "will" } });
  });

  test("a set prints the same in any order, each value once", () => {
    expect(setPrint([{ a: 1 }, { b: 2 }, { a: 1 }])).toBe(setPrint([{ b: 2 }, { a: 1 }]));
    expect(setPrint([{ a: 1 }])).not.toBe(setPrint([{ a: 1 }, { b: 2 }]));
    expect(printsPrint(["b", "a", "a"])).toBe(printsPrint(["a", "b"]));
  });
});

describe("the names a script uses", () => {
  const source = [
    "const SLUGS = new Set([\"shield-block\", 'rend', `pounce`]);",
    "const SAVES = { evasion: \"reflex\", juggernaut: \"will\" };",
    "const BIG = Object.freeze({",
    "  // (a comment)",
    "  stench: Object.freeze({ when: \"both\" })",
    "});",
    "if ( a ? b : c ) x = \"Not A Slug\";"
  ].join("\n");

  test("quoted words and kebab-case, and object keys", () => {
    const { hyphenated, words, keys } = namesIn(source);
    expect([...hyphenated]).toEqual(["shield-block"]);
    expect(words).toEqual(new Set(["rend", "pounce", "reflex", "will", "both"]));
    expect(keys.has("evasion") && keys.has("juggernaut") && keys.has("stench") && keys.has("when")).toBe(true);
    expect(keys.has("b")).toBe(false);
  });

  test("where each is named, and a link to the line", () => {
    const at = whereNamed([{ file: "scripts/x.js", text: source }], ["rend", "stench", "absent"]);
    expect(at.get("rend")).toEqual([{ file: "scripts/x.js", line: 1 }]);
    expect(at.get("stench")).toEqual([{ file: "scripts/x.js", line: 5 }]);
    expect(at.get("absent")).toEqual([]);
    expect(codeLink({ file: "scripts/x.js", line: 5 }, { repo: "o/r", ref: "abc" })).toBe("[x.js:5](https://github.com/o/r/blob/abc/scripts/x.js#L5)");
    expect(codeLink({ file: "scripts/x.js", line: 5 })).toBe("x.js:5");
  });
});

describe("the ledger's files", () => {
  test("one entry per line, sections sorted, and it reads back", () => {
    const value = { system: "test", checked: "1.2.0", entries: { zed: { how: "special", note: "z: y", rules: "abc" }, alpha: { how: "no-fight", note: "a" } }, notSlugs: ["x-y", "a-b"] };
    const text = linesJSON(value);
    const lines = text.split("\n");
    expect(lines).toContain("    \"alpha\": {\"how\": \"no-fight\", \"note\": \"a\"},");
    expect(lines.indexOf("    \"alpha\": {\"how\": \"no-fight\", \"note\": \"a\"},")).toBeLessThan(lines.findIndex(l => l.includes("\"zed\"")));
    expect(lines).toContain("    \"x-y\",");
    expect(JSON.parse(text)).toEqual(value);
  });

  test("versions compare part by part", () => {
    expect(compareVersions("8.10.0", "8.9.2")).toBe(1);
    expect(compareVersions("8.6.1", "8.6.1")).toBe(0);
    expect(compareVersions("8.6", "8.6.1")).toBe(-1);
    expect(newerThan("8.7.0", "8.6.1")).toBe(true);
    expect(newerThan("8.6.1", "8.6.1")).toBe(false);
  });

  test("a stamp keeps the team's words and takes the fresh prints", () => {
    expect(stamp({ how: "elsewhere", note: "ours", rules: "old" }, { version: "2.0", prints: { rules: "new", text: "t" }, date: "2026-01-02" }))
      .toEqual({ how: "elsewhere", note: "ours", reviewed: "2026-01-02", system: "2.0", rules: "new", text: "t" });
    expect(stamp(undefined, { version: "2.0", note: "new case", date: "2026-01-02" })).toMatchObject({ how: "special", note: "new case" });
  });
});

describe("comparing a fresh scan", () => {
  test("special cases: changed fields, and gone", () => {
    const entries = { a: { how: "special", note: "", system: "1", rules: "r1", text: "t1" }, b: { how: "special", rules: "r", text: "t" }, c: { how: "special", rules: "x" } };
    const r = compareSpecial(entries, new Map([["a", { rules: "r1", text: "t2" }], ["b", { rules: "r", text: "t" }]]));
    expect(r.changed).toEqual([{ slug: "a", entry: entries.a, fields: ["text"] }]);
    expect(r.gone.map(g => g.slug)).toEqual(["c"]);
    expect(r.same).toBe(1);
  });

  test("generic readings: changed, added, removed", () => {
    const r = compareGeneric({ a: { built: "1", count: 3 }, b: { built: "2", count: 1 }, c: { built: "3", count: 9 } },
      { a: { built: "1", count: 4 }, b: { built: "9", count: 1 }, d: { built: "4", count: 2 } });
    expect(r.changed.map(x => x.slug)).toEqual(["b"]);
    expect(r.added.map(x => x.slug)).toEqual(["d"]);
    expect(r.removed.map(x => x.slug)).toEqual(["c"]);
  });

  test("named slugs against the ledger", () => {
    const r = compareNamed(["a", "b", "z"], { entries: { a: {}, c: {} }, ignore: { z: "a trait" } });
    expect(r).toEqual({ unrecorded: ["b"], unnamed: ["c"] });
  });
});

describe("the report", () => {
  test("nothing changed", () => {
    const r = buildReport({ system: "Test", version: "2.0", checked: "1.0" });
    expect(r.clean).toBe(true);
    expect(r.text).toContain("# Test 2.0: what changed for FastFighting");
    expect(r.text).toContain("Nothing changed");
    expect(issueTitle("Test", "2.0")).toBe("Test 2.0: what changed for FastFighting");
  });

  test("what changed, candidates first, capped", () => {
    const r = buildReport({
      system: "Test", version: "2.0",
      special: [{ slug: "rend", how: "special", note: "our note", fields: ["rules"], code: ["[g.js:3](u)"] }],
      added: [{ slug: "plain", count: 1, why: [] }, { slug: "greater-rend", count: 2, why: ["like rend"] }],
      commands: { accept: "node tools/review.mjs --accept" }
    }, { limit: 1 });
    expect(r.clean).toBe(false);
    expect(r.counts).toMatchObject({ special: 1, added: 2, candidates: 1 });
    expect(r.text).toContain("| `rend` | special | rules | our note | [g.js:3](u) |");
    expect(r.text).toContain("`greater-rend`");
    expect(r.text).not.toContain("`plain`");
    expect(r.text).toContain("... and 1 more");
    expect(r.text).toContain("`node tools/review.mjs --accept <slug ...>`");
  });

  test("the issue's body stops short of GitHub's limit", () => {
    const long = `${"line\n".repeat(50)}`;
    const body = issueBody(long, { limit: 100, footer: "end" });
    expect(body.length).toBeLessThanOrEqual(100);
    expect(body).toContain("cut short");
    expect(body.trim().endsWith("end")).toBe(true);
    expect(issueBody("short\n", { footer: "f" })).toBe("short\n\nf\n");
  });

  test("pack text can't break out of its code span, mention anyone or link anywhere", () => {
    const J = "\u2060";
    expect(code("rend`](https://x.example) @team\n| x")).toBe("`rend](https://x.example) @team| x`");
    expect(plain("see [this](https://x.example) <https://y.example> www.z.example @team")).toBe(
      `see \\[this\\]\\(https${J}://x.example\\) \\<https${J}://y.example\\> www${J}.z.example @${J}team`);
    expect(issueTitle("PF2e", "8.7.0 @team\n[x](y)")).toBe("PF2e 8.7.0teamxy: what changed for FastFighting");
    const r = buildReport({
      system: "PF2e", version: "9.0.0",
      added: [{ slug: "evil`@team", kind: "spell @team", count: 1, level: "<b>", why: ["[x](https://x.example)"] }],
      extra: [{ title: "Extra", head: ["name"], rows: [[code("@team")]] }]
    });
    const body = issueBody(r.text);
    expect(body).not.toMatch(/@(?!\u2060)/);
    expect(body).not.toContain("](https://");
    expect(body).toContain(`| \`evil@${J}team\` |`);
  });
});
