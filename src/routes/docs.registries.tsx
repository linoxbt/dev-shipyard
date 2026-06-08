import { createFileRoute } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { DocPage, P, H3, Callout, PageNav } from "@/components/docs/primitives";
import { CodeBlock } from "@/components/shared/CodeBlock";
import { docNeighbors } from "@/components/docs/nav";

export const Route = createFileRoute("/docs/registries")({
  head: () => ({ meta: [{ title: "Onchain Registries - DevStation Docs" }] }),
  component: Registries,
});

function Registries() {
  const { prev, next } = docNeighbors("/docs/registries");
  return (
    <DocPage
      title="Onchain Registries"
      icon={ShieldCheck}
      intro="DevStation keeps the records that matter onchain. Two registry contracts back the app, so your deployment history and contract labels are auditable and portable rather than locked in a private database."
    >
      <H3>ProjectRegistry</H3>
      <P>
        Records every contract deployed through DevStation against the deploying wallet, and keeps a
        global counter of total deployments. The Projects page reads your deployments back from it,
        scoped to your connected wallet. The Overview reads the global counter for the total
        contracts and total users stats.
      </P>
      <CodeBlock
        language="solidity"
        showLineNumbers={false}
        code={`function recordDeployment(
  address contractAddress,
  string calldata templateId,
  string calldata projectName,
  string calldata network,
  string calldata txHash
) external;

function getDeployments(address deployer)
  external view returns (Deployment[] memory);

uint256 public totalDeployments;`}
      />
      <H3>ContractLabelRegistry</H3>
      <P>
        Stores human-readable labels for contracts, with a source (auto, community, or verified) and
        the submitter. Routebook and the Label Registry page read from it.
      </P>
      <Callout>
        Registry writes use an explicit gas limit. QIE&apos;s gas estimator can under-report the gas
        a storage-writing call needs, so DevStation pins a safe limit to keep these transactions
        from running out of gas. At QIE&apos;s gas price this costs a negligible fraction of a QIE.
      </Callout>
      <PageNav prev={prev} next={next} />
    </DocPage>
  );
}
