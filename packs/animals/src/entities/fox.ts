// A fox: tall ears, a bushy tail, a long snout; coats tipped, muzzle or socks.
import { animal } from "../species.ts";

export default animal("fox", {
  title: "Fox",
  tags: ["animal", "fox", "wild"],
  choices: ["coat", "earSize", "tail", "snout", "head", "legs", "girth", "height", "eyes", "stride"],
  size: [0.28, 0.42],
});
