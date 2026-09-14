// A deer: ears out to the side, a stub tail, long legs; antlers or none.
import { animal } from "../species.ts";

export default animal("deer", {
  title: "Deer",
  tags: ["animal", "deer", "wild", "herd"],
  choices: ["antlers", "coat", "earSize", "snout", "head", "legs", "girth", "height", "eyes", "stride"],
  size: [0.8, 1.1],
});
