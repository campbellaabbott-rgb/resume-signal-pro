// The suite's own config (and so its own setupFiles), narrowed to one fixture
// and one fork. Used by the-test-setup-deleted-every-pdf-in-the-project-root.test.ts.
import path from "node:path";
import base from "../../../vitest.config";

export default {
  ...base,
  root: path.resolve(__dirname, "../../.."),
  test: {
    ...base.test,
    environment: "node",
    include: ["src/test/fixtures/a-test-that-writes-a-pdf.fixture.ts"],
    maxWorkers: 1,
  },
};
