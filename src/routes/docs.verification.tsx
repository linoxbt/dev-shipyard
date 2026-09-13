import { createFileRoute } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { DocPage, H2, P, Steps, Callout, Bullets, DocLink } from "@/components/docs/primitives";

export const Route = createFileRoute("/docs/verification")({
  head: () => ({ meta: [{ title: "Contract Verification · DevStation Docs" }] }),
  component: Verification,
});

function Verification() {
  return (
    <DocPage
      title="Contract Verification"
      icon={ShieldCheck}
      intro="Verifying publishes a contract's source on the network explorer, so anyone can read it and check that it matches the bytecode on chain."
    >
      <H2>Right after a deploy</H2>
      <P>
        The deploy success screen offers to verify. DevStation knows the exact compiler build and
        settings it used, sends the source, and lets the explorer detect the constructor arguments.
        You can also verify an earlier deployment from My Projects.
      </P>

      <H2>Any contract, by hand</H2>
      <Steps
        steps={[
          {
            title: "Open the form",
            body: "From an unverified contract's page in the explorer, or the Verify Contract link in the explorer header.",
          },
          {
            title: "Fill in the details",
            body: "Contract address, compiler version, optimisation and runs, licence, and the flattened Solidity source.",
          },
          {
            title: "Submit",
            body: "DevStation sends it to that network's explorer and waits until it confirms, then links to the verified contract.",
          },
        ]}
      />

      <H2>If it does not verify</H2>
      <Bullets
        items={[
          "The source must be one flattened file with every import inline. The Contract Editor can produce it.",
          "The compiler version and optimisation settings must be exactly those used to deploy.",
          "Constructor arguments must match; the explorer detects them from the creation transaction.",
        ]}
      />
      <Callout>
        Verification relies on the network explorer&apos;s verifier. If it is slow to confirm, the
        contract still works normally, and the submission completes once the explorer processes it.
      </Callout>
      <P>
        Verified contracts count towards the Verified and Open book{" "}
        <DocLink to="/docs/dashboard">achievements</DocLink>.
      </P>
    </DocPage>
  );
}
