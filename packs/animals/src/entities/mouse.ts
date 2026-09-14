// A mouse: big round ears, a thin tail as long as it is.
import { animal } from "../species.ts";

export default animal("mouse", {
  title: "Mouse",
  tags: ["animal", "mouse", "wild"],
  choices: ["coat", "earSize", "tail", "snout", "head", "girth", "height", "eyes"],
  size: [0.04, 0.07],
});
