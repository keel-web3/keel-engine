// A rabbit: long or lop ears, a puff of a tail; it bounds rather than trots.
import { animal } from "../species.ts";

export default animal("rabbit", {
  title: "Rabbit",
  tags: ["animal", "rabbit", "pet"],
  choices: ["coat", "ears", "earSize", "tail", "head", "legs", "girth", "height", "eyes"],
  size: [0.12, 0.2],
});
