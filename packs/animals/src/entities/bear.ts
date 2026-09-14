// A bear: round ears, a stub of a tail, a heavy build; coats muzzle or plain.
import { animal } from "../species.ts";

export default animal("bear", {
  title: "Bear",
  tags: ["animal", "bear", "wild"],
  choices: ["coat", "earSize", "snout", "head", "legs", "girth", "height", "eyes", "stride"],
  size: [0.7, 1.1],
});
