// Who gets in. Edit this file, nothing else, to gate on different holdings.
//
// kind "erc20":  balanceOf(wallet) >= min, where min is in whole tokens and
//                `decimals` says how to read it.
// kind "erc721": balanceOf(wallet) >= min, a count of NFTs.
// mode "all" needs every rule to pass; "any" needs one.

import { QIE_ID, QUSDC } from "./contract.js";

export const GATE = {
  title: "QIE Members",
  mode: "all",
  rules: [
    { label: "Holds a QIE ID (.qie name)", kind: "erc721", address: QIE_ID, min: "1" },
    {
      label: "Holds at least 1 QUSDC",
      kind: "erc20",
      address: QUSDC.address,
      decimals: QUSDC.decimals,
      min: "1",
    },
  ],
};
