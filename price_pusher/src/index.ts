// #!/usr/bin/env node
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import sei from "./sei/command";

yargs(hideBin(process.argv))
  .config("config")
  .global("config")
  .command(sei)
  .help().argv;
