import assert from "node:assert/strict";
import { test } from "node:test";
import {
  claimTypeRecommendation,
  optionId,
  sctGroups,
} from "../cjts-prefiling/claim-type.mjs";
import { parsePackage } from "../cjts-prefiling/transfer.mjs";

test("SCT mapping contains all current unique group options", () => {
  assert.equal(sctGroups.length, 4);
  assert.equal(
    sctGroups.reduce((count, group) => count + group.options.length, 0),
    22,
  );
  const ids = sctGroups.flatMap((group) =>
    group.options.map((label) => optionId(group.id, label)),
  );
  assert.equal(new Set(ids).size, 22);
  assert.ok(ids.every(Boolean));
});

test("only exact reviewed categories suggest a specific checkbox", () => {
  assert.deepEqual(claimTypeRecommendation("Sale of goods"), {
    groupId: "goods",
  });
  assert.deepEqual(claimTypeRecommendation("Motor vehicle deposit"), {
    groupId: "goods",
    option: "Refund (motor vehicle deposit)",
  });
  assert.deepEqual(claimTypeRecommendation("Unfair practice"), {
    groupId: "goods",
  });
  assert.equal(claimTypeRecommendation("Not sure yet"), null);
});

test("assessment helper accepts the reviewed transfer contract", () => {
  const pack = parsePackage({
    version: 2,
    generatedAt: new Date().toISOString(),
    userReviewed: true,
    fields: {
      claimType: {
        value: "Motor vehicle deposit",
        review: "approved",
        provenance: "user",
      },
      amount: { value: "1500.50", review: "approved", provenance: "user" },
    },
    assessment: { sctOptions: [{ groupId: "goods", label: "Refund (motor vehicle deposit)" }] },
  });
  assert.equal(pack.fields.amount.value, "1500.50");
  assert.throws(
    () =>
      parsePackage({
        ...pack,
        fields: {
          ...pack.fields,
          amount: {
            value: "SGD 1500",
            review: "approved",
            provenance: "user",
          },
        },
      }),
    /amount/,
  );
});
