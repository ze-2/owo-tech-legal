import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { assistForm } from "../../cjts-prefiling/form-assist.mjs";
import { parsePackage } from "../../cjts-prefiling/transfer.mjs";

test("conversation → challenge → field approval → export → assisted mock form transfer", async ({
  page,
}) => {
  await page.goto("/");
  const original = "我给装修公司三千块订金，他们说三月开始可是一直没有来。";
  await page.getByLabel("Your next message").fill(original);
  await page.getByRole("button", { name: "Add to conversation" }).click();
  await expect(
    page.getByText("Working interpretation: Unknown — exact value unresolved"),
  ).toBeVisible();
  await page
    .getByLabel("Your next message")
    .fill(
      "Claimant: Mei Lim\nRespondent: Example Renovation\nClaim amount: 3000\nThe contractor refused to refund me.",
    );
  await page.getByRole("button", { name: "Add to conversation" }).click();
  await expect(
    page.getByRole("button", { name: "Review organised conversation" }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Review organised conversation" })
    .click();
  await expect(page.getByLabel("Your details (claimant)")).toHaveValue(
    "Mei Lim",
  );
  await page
    .getByLabel("What you are asking for")
    .fill("Refund of the deposit");
  await page.getByRole("button", { name: "Your story", exact: true }).click();
  await page
    .getByLabel("Attach evidence files")
    .setInputFiles({
      name: "message.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "We will discuss a refund after inspection of the work.",
      ),
    });
  await page.getByRole("button", { name: /Prepare to file/ }).click();
  await expect(
    page
      .getByRole("heading", { name: "Possible contradictory evidence" })
      .first(),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Unsupported statement" }).first(),
  ).toBeVisible();
  await expect(page.getByLabel("Approve Cause-of-action date")).toBeDisabled();
  for (const name of [
    "Claimant particulars",
    "Respondent particulars",
    "Claim amount",
    "Description of claim",
    "Requested outcome",
  ])
    await page.getByLabel(`Approve ${name}`, { exact: true }).check();
  const downloaded = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export approved filing JSON" })
    .click();
  const file = await downloaded;
  const pack = parsePackage(await readFile((await file.path())!, "utf8"));
  expect(pack.fields.incidentDate).toBeUndefined();
  expect(pack.fields.summary.value).toContain(original);
  await page.getByRole("button", { name: /Organise your claim/ }).click();
  await page.getByLabel("Your details (claimant)").fill("Mei Tan");
  await page.getByRole("button", { name: /Prepare to file/ }).click();
  await expect(
    page.getByLabel("Approve Claimant particulars", { exact: true }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("button", { name: "Export approved filing JSON" }),
  ).toBeDisabled();

  await page.goto("/mock-cjts.html");
  const preview = await page.evaluate(
    ({ fn, fields }) => (0, eval)(`(${fn})`)("preview", fields),
    { fn: assistForm.toString(), fields: pack.fields },
  );
  const selected = preview
    .filter((r: { found: boolean }) => r.found)
    .map((r: { key: string }) => r.key)
    .filter((key: string) => key !== "respondent");
  const signatures = Object.fromEntries(
    preview.map((r: { key: string; signature: string }) => [
      r.key,
      r.signature,
    ]),
  );
  await page.evaluate(
    ({ fn, fields, selected, signatures }) =>
      (0, eval)(`(${fn})`)("fill", fields, selected, signatures),
    { fn: assistForm.toString(), fields: pack.fields, selected, signatures },
  );
  await expect(page.getByLabel("Claimant particulars")).toHaveValue("Mei Lim");
  await expect(page.getByLabel("Respondent particulars")).toHaveValue("");
  await expect(page.getByLabel("Claim amount (SGD)")).toHaveValue("3000");
  await expect(page.getByLabel("Description of claim")).toHaveAttribute(
    "data-clearclaim-filled",
    "true",
  );
  await expect(page.locator("#submission-status")).toHaveText(
    "Nothing submitted.",
  );
  expect(
    await page.evaluate(
      () => (window as unknown as { submissionCount: number }).submissionCount,
    ),
  ).toBe(0);
});

test("microphone permission failure preserves typed input and permits continuing", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => {
        throw new DOMException("Denied by user", "NotAllowedError");
      },
    });
    class DeniedRecognition {
      onerror?: (event: { error: string }) => void;
      start() {
        this.onerror?.({ error: "not-allowed" });
      }
      abort() {}
      stop() {}
    }
    Object.defineProperty(window, "SpeechRecognition", {
      value: DeniedRecognition,
      configurable: true,
    });
  });
  await page.goto("/");
  await page
    .getByLabel("Your next message")
    .fill("My typed account remains here.");
  await page
    .getByLabel("I allow OpenRouter and its transcription provider")
    .check();
  await page.getByRole("button", { name: "Start microphone" }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Microphone permission was denied" }),
  ).toBeVisible();
  await expect(page.getByLabel("Your next message")).toHaveValue(
    "My typed account remains here.",
  );
  await expect(
    page.getByRole("button", { name: "Add to conversation" }),
  ).toBeEnabled();
});

test("semantic mapping skips ambiguous, hidden, occupied, overlong and unmatched-option fields", async ({
  page,
}) => {
  await page.goto("/mock-cjts.html");
  await page.getByLabel("Claimant particulars").fill("Do not overwrite");
  await page.evaluate(() => {
    const duplicate = document.createElement("textarea");
    duplicate.setAttribute("aria-label", "Description of claim");
    document.querySelector("form")!.append(duplicate);
    document.querySelector<HTMLInputElement>("#incident")!.hidden = true;
    document.querySelector<HTMLTextAreaElement>("#outcome")!.maxLength = 5;
  });
  const fields = Object.fromEntries(
    Object.entries({
      claimant: "New",
      summary: "Description",
      incidentDate: "2026-03-14",
      outcome: "Refund payment",
      claimType: "Unknown option",
    }).map(([key, value]) => [
      key,
      { value, review: "approved", provenance: "user" },
    ]),
  );
  const rows = await page.evaluate(
    ({ fn, fields }) => (0, eval)(`(${fn})`)("preview", fields),
    { fn: assistForm.toString(), fields },
  );
  expect(rows.every((row: { found: boolean }) => !row.found)).toBe(true);
  expect(rows.map((row: { reason: string }) => row.reason).join(" ")).toMatch(
    /Ambiguous/,
  );
});

test("microphone records multilingual audio and releases tracks before transcription", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["microphone"]);
  await page.addInitScript(() => {
    const streams: MediaStream[] = [];
    Object.assign(window, { recordedStreams: streams });
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await getUserMedia(constraints);
      streams.push(stream);
      return stream;
    };
  });
  await page.route("**/api/transcribe", async (route) => {
    expect(route.request().postDataBuffer()?.length).toBeGreaterThan(0);
    expect(route.request().postDataBuffer()?.toString()).toContain("zh");
    await route.fulfill({ json: { text: "我付了订金。" } });
  });
  await page.goto("/");
  await page.getByLabel("Speech language").selectOption("zh-CN");
  await page.getByLabel("Your next message").fill("Existing text.");
  await expect(
    page.getByRole("button", { name: "Start microphone" }),
  ).toBeDisabled();
  await page
    .getByLabel("I allow OpenRouter and its transcription provider")
    .check();
  await page.getByRole("button", { name: "Start microphone" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Listening." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Stop microphone" }).click();
  await expect(page.getByLabel("Your next message")).toHaveValue(
    "Existing text. 我付了订金。",
  );
  await expect(
    page.getByRole("button", { name: "Add to conversation" }),
  ).toBeEnabled();
  expect(
    await page.evaluate(() =>
      (
        window as unknown as { recordedStreams: MediaStream[] }
      ).recordedStreams.every((stream) =>
        stream.getTracks().every((track) => track.readyState === "ended"),
      ),
    ),
  ).toBe(true);
});

test("missing browser recording support preserves the typed workflow", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => ({ getTracks: () => [{ stop() {} }] }),
    });
    Object.defineProperty(window, "MediaRecorder", { value: undefined });
  });
  await page.goto("/");
  await page
    .getByLabel("I allow OpenRouter and its transcription provider")
    .check();
  await page.getByRole("button", { name: "Start microphone" }).click();
  await expect(
    page
      .getByRole("status")
      .filter({
        hasText: "This browser does not support microphone recording",
      }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Stop microphone" }),
  ).toBeDisabled();
});

test("cancelling pending transcription discards the late transcript", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["microphone"]);
  let complete: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    complete = resolve;
  });
  await page.route("**/api/transcribe", async (route) => {
    await pending;
    await route.fulfill({ json: { text: "Late transcript" } }).catch(() => {});
  });
  await page.goto("/");
  await page.getByLabel("Your next message").fill("Keep this.");
  await page
    .getByLabel("I allow OpenRouter and its transcription provider")
    .check();
  await page.getByRole("button", { name: "Start microphone" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Listening." }),
  ).toBeVisible();
  const request = page.waitForRequest("**/api/transcribe");
  await page.getByRole("button", { name: "Stop microphone" }).click();
  await request;
  await expect(
    page.getByRole("status").filter({ hasText: "Transcribing your recording" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add to conversation" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Stop microphone" }).click();
  complete();
  await expect(page.getByLabel("Your next message")).toHaveValue("Keep this.");
  await expect(
    page.getByRole("button", { name: "Start microphone" }),
  ).toBeEnabled();
});

test("cancelling a pending microphone request cannot start recognition later", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const events: string[] = [];
    Object.assign(window, { microphoneEvents: events });
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: () =>
        new Promise((resolve) => {
          Object.assign(window, {
            resolveMicrophone: () =>
              resolve({
                getTracks: () => [{ stop: () => events.push("probe-stopped") }],
              }),
          });
        }),
    });
    class Recognition {
      start() {
        events.push("recognition-start");
      }
      abort() {}
    }
    Object.defineProperty(window, "SpeechRecognition", { value: Recognition });
  });
  await page.goto("/");
  await page
    .getByLabel("I allow OpenRouter and its transcription provider")
    .check();
  await page.getByRole("button", { name: "Start microphone" }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Requesting microphone access" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Stop microphone" }).click();
  await page.evaluate(() =>
    (
      window as unknown as { resolveMicrophone: () => void }
    ).resolveMicrophone(),
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { microphoneEvents: string[] })
            .microphoneEvents,
      ),
    )
    .toEqual(["probe-stopped"]);
  await expect(
    page.getByRole("button", { name: "Start microphone" }),
  ).toBeEnabled();
});

test("microphone is allowed by the response policy and native browser media API", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["microphone"]);
  const response = await page.goto("/");
  expect(response?.headers()["permissions-policy"]).toContain(
    "microphone=(self)",
  );
  expect(response?.headers()["permissions-policy"]).toContain("camera=()");
  // Uses Chromium's synthetic device, not a stub or the user's physical microphone.
  const result = await page.evaluate(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const count = stream.getAudioTracks().length;
    stream.getTracks().forEach((track) => track.stop());
    return {
      count,
      stopped: stream
        .getTracks()
        .every((track) => track.readyState === "ended"),
    };
  });
  expect(result).toEqual({ count: 1, stopped: true });
});
