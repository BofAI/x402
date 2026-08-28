const title = process.env.PR_TITLE ?? process.argv[2] ?? "";
const body = process.env.PR_BODY ?? process.argv[3] ?? "";

const errors = [];
const titleLength = [...title].length;
const titlePattern =
  /^(feat|fix|refactor|docs|style|test|chore|ci|perf|build|revert)(\([A-Za-z0-9._/*-]+\))?: [a-z0-9].*[^.]$/;

if (titleLength < 10 || titleLength > 72) {
  errors.push(`PR title must be 10-72 characters; got ${titleLength}.`);
}

if (!titlePattern.test(title)) {
  errors.push(
    "PR title must match type(scope): description, use an allowed type, start the description " +
      "with a lowercase letter or number, and not end with a period.",
  );
}

const bodyWithoutComments = body.replace(/<!--[\s\S]*?-->/g, "");
const descriptionMatch = bodyWithoutComments.match(
  /(?:^|\n)## Description\s*\n([\s\S]*?)(?=\n## |$)/i,
);
const description = descriptionMatch?.[1].trim() ?? "";
const descriptionLength = [...description].length;

if (descriptionLength < 20) {
  errors.push(
    `PR Description section must contain at least 20 characters; got ${descriptionLength}.`,
  );
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(error);
  }
  process.exit(1);
}

console.log(`PR metadata is valid: ${title}`);
