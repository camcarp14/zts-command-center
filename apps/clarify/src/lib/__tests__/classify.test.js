import { describe, it, expect } from "vitest";
import { classifyHeuristic, CLASSIFICATIONS } from "../classify";

describe("classifyHeuristic", () => {
  it("detects scheduling intent ahead of generic interest", () => {
    expect(classifyHeuristic("Sounds good — what times work? Wednesday at 2 would be great").classification).toBe("scheduling");
    expect(classifyHeuristic("Sure, send me a calendly link").classification).toBe("scheduling");
    expect(classifyHeuristic("Can we schedule a call next week?").classification).toBe("scheduling");
  });
  it("does not call a rejection scheduling just because it names a day", () => {
    expect(classifyHeuristic("Not interested, don't contact me monday or ever").classification).toBe("not_interested");
  });
  it("maps legacy tiers onto the new taxonomy", () => {
    expect(classifyHeuristic("yes, very interested — tell me more").classification).toBe("interested");
    expect(classifyHeuristic("unsubscribe").classification).toBe("not_interested");
    expect(classifyHeuristic("we already have an agency, why would you be different").classification).toBe("objection");
    expect(classifyHeuristic("thanks for reaching out").classification).toBe("neutral");
  });
  it("every classification key has display metadata", () => {
    for (const key of ["scheduling", "interested", "objection", "question", "neutral", "not_interested"]) {
      expect(CLASSIFICATIONS[key]).toBeTruthy();
      expect(CLASSIFICATIONS[key].label).toBeTruthy();
      expect(CLASSIFICATIONS[key].color).toMatch(/^#|rgb/);
    }
  });
});
