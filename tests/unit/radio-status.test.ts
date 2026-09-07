import { describe, it, expect } from "vitest";
import {
  parseIcecast,
  parseShoutcast7,
  parseShoutcastStats,
} from "@/lib/radio-status";

describe("parseIcecast", () => {
  it("parses a single source object", () => {
    const body = JSON.stringify({
      icestats: { source: { listenurl: "x", listeners: 104, title: "Artist - Song" } },
    });
    expect(parseIcecast(body)).toEqual({ song: "Artist - Song", listeners: 104 });
  });

  it("parses a source array and matches the requested mount", () => {
    const body = JSON.stringify({
      icestats: {
        source: [
          { listenurl: "x", listeners: 5, mount: "/other", title: "Other Show" },
          { listenurl: "y", listeners: 12, mount: "/crown", title: "" },
        ],
      },
    });
    expect(parseIcecast(body, "/crown")).toEqual({ song: null, listeners: 12 });
  });

  it("returns nulls when a title is missing or placeholder", () => {
    const body = JSON.stringify({ icestats: { source: { listeners: 3 } } });
    expect(parseIcecast(body)).toEqual({ song: null, listeners: 3 });
    const body2 = JSON.stringify({ icestats: { source: { title: "Untitled", listeners: 3 } } });
    expect(parseIcecast(body2)).toEqual({ song: null, listeners: 3 });
  });

  it("returns nulls for invalid json", () => {
    expect(parseIcecast("not json")).toEqual({ song: null, listeners: null });
  });
});

describe("parseShoutcast7", () => {
  it("parses the classic 7.html format", () => {
    expect(parseShoutcast7("0,121,506,256,24,128,Artist - Title")).toEqual({
      song: "Artist - Title",
      listeners: 121,
    });
    expect(parseShoutcast7("609,1,5000,5000,26,128,")).toEqual({
      song: null,
      listeners: 1,
    });
  });

  it("returns nulls for non-7.html payloads", () => {
    expect(parseShoutcast7("<html>nope</html>")).toEqual({ song: null, listeners: null });
  });
});

describe("parseShoutcastStats", () => {
  it("parses DNAS v2 stats json", () => {
    const body = JSON.stringify({
      currentlisteners: 608,
      peaklisteners: 5000,
      songtitle: "Live Sport",
    });
    expect(parseShoutcastStats(body)).toEqual({ song: "Live Sport", listeners: 608 });
  });

  it("handles alt listeners key and empty song", () => {
    const body = JSON.stringify({ listeners: 12, songtitle: "" });
    expect(parseShoutcastStats(body)).toEqual({ song: null, listeners: 12 });
  });

  it("returns nulls for invalid json", () => {
    expect(parseShoutcastStats("oops")).toEqual({ song: null, listeners: null });
  });
});