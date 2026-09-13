import { createFileRoute } from "@tanstack/react-router";
import { Boxes } from "lucide-react";
import { DocPage, H2, H3, P, Table, Code, Callout, C } from "@/components/docs/primitives";

export const Route = createFileRoute("/docs/registries")({
  head: () => ({ meta: [{ title: "Contracts & Registries · DevStation Docs" }] }),
  component: Registries,
});

function Registries() {
  return (
    <DocPage
      title="Contracts & Registries"
      icon={Boxes}
      intro="The records that matter are kept on chain, so they are auditable and portable rather than locked in a private database. These are the contracts DevStation runs on."
    >
      <H2>Addresses</H2>
      <H3>QIE Mainnet (1990)</H3>
      <Table
        head={["Contract", "Address"]}
        rows={[
          ["ProjectRegistry", "0x673e3d4d7f6043d0384e95ce0c110f09e09ec708"],
          ["ContractLabelRegistry", "0xb6075e4cad1f7e7e779e49dcf7df08949797ed81"],
          ["DevStationMarketplace", "0xeeae4de6198cbcc837240115e86554c6968ba51d"],
          ["TemplateRegistry (classic)", "0xdfe2f883bab871fe128eedc05c954cf069e67302"],
          ["QUSDC", "0x3F43DA82eC9A4f5285F10FaF1F26EcA7319E5DA5"],
          ["QIE ID", "0x9aab56e7727af53A3131985BFB16d845319b7bdc"],
        ]}
      />
      <H3>QIE Testnet (1983)</H3>
      <Table
        head={["Contract", "Address"]}
        rows={[
          ["ProjectRegistry", "0x75d7b39bc827367c409e1a2bf805bd5f337ca27b"],
          ["ContractLabelRegistry", "0x177294293e6e785a83e036a95de1697e3cc04748"],
          ["DevStationMarketplace", "0xec783dbd04509faa96c7edbf26c681408201cd2f"],
        ]}
      />

      <H2>ProjectRegistry</H2>
      <P>
        Records every contract deployed through DevStation against the wallet that deployed it, with
        a global counter. Your dashboard, the leaderboard, analytics and the overview totals are all
        read from it.
      </P>
      <Code
        language="solidity"
        code={`function recordDeployment(
  address contractAddress,
  string calldata templateId,
  string calldata projectName,
  string calldata network,
  string calldata txHash
) external;

function getDeployments(address deployer) external view returns (Deployment[] memory);

uint256 public totalDeployments;`}
      />

      <H2>ContractLabelRegistry</H2>
      <P>
        Stores readable names for contracts, with a source (auto, community or verified) and the
        wallet that submitted each. Routebook and the Label Registry page read it.
      </P>

      <H2>DevStationMarketplace</H2>
      <P>
        Holds every listing, with its price, currency, pricing model and the SHA-256 hash of its
        files, and records purchases, per-deploy payments, tips and featuring. Payments accumulate
        per creator and are withdrawn by the creator. The protocol fee is fixed at 5% of sales (
        <C>PROTOCOL_FEE_BPS = 500</C>) and nothing of tips.
      </P>
      <Code
        language="solidity"
        code={`function publish(uint8 kind, uint8 currency, uint8 model, uint96 price,
  string name, string description, string metadataJson, bytes32 contentHash) returns (uint256 id);
function buy(uint256 id) external payable;
function recordDeploy(uint256 id) external payable;
function tip(uint256 id, uint256 amount) external payable;
function feature(uint256 id, uint256 days_) external payable;
function withdraw(address token) external;
function hasAccess(uint256 id, address wallet) external view returns (bool);`}
      />

      <H2>TemplateRegistry</H2>
      <P>
        The earlier template marketplace, where a template&apos;s source and ABI are stored on
        chain. Its listings still appear in the Marketplace as classic templates.
      </P>

      <Callout>
        Registry writes use an explicit gas limit. Some networks&apos; gas estimators under-report
        what a storage-writing call needs, so DevStation sets a safe limit to keep these
        transactions from running out of gas.
      </Callout>
    </DocPage>
  );
}
