import { describe, expect, it } from "vitest";

import { cn } from "@/lib/utils";

describe("cn", () => {
  it("joins conditional class names", () => {
    expect(cn("a", false && "b", "c")).toBe("a c");
  });

  it("lets the later Tailwind class win", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });
});
