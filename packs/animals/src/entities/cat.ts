// A cat: pointed or tufted ears, a long tail; coats plain, socks, muzzle or tipped.
import { animal } from "../species.ts";

export default animal("cat", {
  title: "Cat",
  tags: ["animal", "cat", "pet"],
  choices: ["coat", "ears", "earSize", "tail", "head", "legs", "girth", "height", "eyes", "stride"],
  size: [0.2, 0.32],
});
