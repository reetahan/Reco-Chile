// One file per namespace so parallel work on different wizard steps never
// edits the same catalogue file. Add a namespace here AND in the other
// locale's index.ts; lib/i18n-messages.test.ts enforces identical key sets.
import app from "./app.json";
import steps from "./steps.json";
import student from "./student.json";
import list from "./list.json";
import result from "./result.json";
import improve from "./improve.json";
import errors from "./errors.json";
import enums from "./enums.json";
import filters from "./filters.json";
import wishes from "./wishes.json";

const messages = {
  app,
  steps,
  student,
  list,
  result,
  improve,
  errors,
  enums,
  filters,
  wishes,
};

export default messages;
