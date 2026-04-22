#!/usr/bin/env node
import { run, flush, Errors } from "@oclif/core";

void run()
  .then(() => flush())
  .catch(Errors.handle);
