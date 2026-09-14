// A dog: floppy or pointed ears, a long tail, a long snout; coats plain, muzzle or socks.
import { animal } from "../species.ts";

export default animal("dog", {
  title: "Dog",
  tags: ["animal", "dog", "pet", "herd"],
  choices: ["coat", "ears", "earSize", "tail", "snout", "head", "legs", "girth", "height", "eyes", "stride"],
  size: [0.35, 0.7],
});
