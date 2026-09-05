import { ClaimWorkspace } from "@/components/claim-workspace";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <ClaimWorkspace
      researchConfigured={Boolean(
        process.env.EXA_API_KEY && process.env.OPENAI_API_KEY,
      )}
    />
  );
}
