# QIE Pay Link

Request a payment in QIE or QUSDC on QIE Mainnet with a link, and pay one.

A request is just a link: `?to=<address>&amount=<number>&token=QIE|QUSDC&memo=<note>`. Nothing is stored anywhere. Whoever opens it:

1. connects a wallet;
2. is moved to QIE Mainnet;
3. has their balance checked;
4. pays.

The app then waits for the receipt and only reports "Paid" when the transaction succeeded.

## Files

| File | What it is |
| --- | --- |
| `index.html` | Page shell and the import map (preact, htm, viem) |
| `app.js` | Request form, pay view, link parsing |
| `contract.js` | QIE Mainnet settings, QUSDC, the ERC-20 ABI, the explicit gas for token transfers |
| `wallet.js` | Wallet access: `window.ethereum`, or DevStation's preview bridge |
| `styles.css` | Styling |

## Run it

- In DevStation: clone it into your apps; it previews straight away. Publish it to get a real web address, and links start working anywhere.
- Anywhere else: serve the `app` folder over HTTP, for example `npx serve app`.

## Notes

- **Explicit gas:** QUSDC transfers send a gas limit of 150,000, because QIE's gas estimate is too low for writes that touch storage.
- **The note:** it lives only in the link, and ERC-20 transfers have no memo field. To tie payments to orders on chain, use a checkout contract. DevStation's `qusdc-checkout` skill builds one.
