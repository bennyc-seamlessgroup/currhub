# CURR Hub MVP

可重新品牌化的 Next.js Web3 Portal 原型。這是**測試網與本機模擬環境**，並非可處理真實資產、證券、付款或身份驗證的正式產品。

## 現況

原本的 GitHub repository 與使用者本機 `CURR HUB` 專案資料夾均為空白。此專案從零建立。**未部署任何鏈上合約或 Solana mint，亦未進行真實付款或空投。**

| 功能 | MVP 實作 | 資料來源 / 限制 |
|---|---|---|
| User Dashboard | 概覽、已連接錢包的真實 tCURR 餘額與最近示範活動 | tCURR 讀取 Sepolia 合約；其他數字仍為本機 demo ledger |
| Ethereum Wallet | 在網站選擇已安裝的 EVM wallet（EIP-6963 或注入式備援）、由 wallet 核准連接並切換 Sepolia，讀取 Sepolia ETH | 不用在聊天或網站手動輸入錢包地址；不簽交易 |
| Solana Wallet | 在網站選擇偵測到的 Phantom、Solflare 或注入式 Solana wallet，向 Devnet RPC 讀取 SOL | 只查 Devnet；不能更改 wallet 自身網絡設定 |
| uCURR / tCURR | 讀取已連接 Ethereum wallet 的 Sepolia tCURR ERC-20 餘額；另有示範 uCURR 帳本及可編譯的測試合約 | 須提供現有 Sepolia tCURR 合約地址；本 repo 沒有部署合約或鑄造 token |
| Admin Dashboard | 輸入／更新示範 tCURR 持倉、資格、uCURR pool、建立 snapshot | 本機模擬；沒有真正管理員認證 |
| Airdrop | 按 eligible tCURR 比例計算、固定 snapshot、每地址一次的 demo claim | claim 只更新本機 demo ledger；正式規則待主管決定 |
| Registration / KYC | 本機註冊資料及自我聲明式 demo KYC | 不驗證身分；不收集身份文件 |
| Swap | uCURR ↔ demo USDC 固定匯率交換 | 純本機餘額，不接 DEX；tCURR 不可交換 |
| Credit card Sandbox | 模擬 USD 購買報價及訂單 | 不收卡資料、不連 payment gateway、絕不扣款 |

## 執行

需要 Node.js 20.9 或以上與 npm。

```bash
npm ci
cp .env.example .env.local
npm run dev
```

開啟 `http://localhost:3000`。`NEXT_PUBLIC_SOLANA_DEVNET_RPC` 預設為 Solana 公共 Devnet RPC。若已知 Sepolia tCURR 合約地址，可設定 `NEXT_PUBLIC_TCURR_SEPOLIA_ADDRESS`；也可在 **My wallets** 頁面輸入合約地址，僅儲存在該瀏覽器。只把**公開** RPC URL 和合約地址放在 `NEXT_PUBLIC_` 變數，不要把私鑰、API secret 或 admin credential 放進前端環境變數。

### 操作流程

1. 在 **My wallets** 按 **Choose wallet**，選擇瀏覽器已安裝的錢包並在錢包內批准連接。Portal 自動取得該錢包的公開地址，不需把錢包地址發給開發者。若有已部署的 Sepolia tCURR 合約，輸入其**合約地址**（不是錢包地址），Portal 會讀取該錢包的真實 ERC-20 `balanceOf`。可按 **Add token to wallet** 讓錢包顯示此 token；匯入 token 不會增加餘額。Solana wallet 仍可連接並讀取 Devnet SOL。
2. 在 **Account & KYC** 用測試資料建立 demo account，填地區並標記 demo KYC approved。這不是正式 KYC。
3. 在 **Admin simulator** 將已連接 wallet 地址加入示範 tCURR 持倉，設為 eligible，設定 pool，再建立 demo snapshot。
4. 在 **Airdrop** 查看固定於該 snapshot 的 allocation 並記錄 demo claim。更改持倉不會改動既有 snapshot；建立新 snapshot 才會重算，並清空該 snapshot 的 claim 紀錄。
5. 在 **Swap demo** 和 **Buy sandbox** 試用本機示範流程。頁面會明確顯示沒有鏈上交易或扣款。

瀏覽器資料儲存在 `localStorage`。不同裝置、瀏覽器或使用者之間不會同步；清除瀏覽器資料即會失去紀錄。**不能把 localStorage 用作正式帳本、空投資格或已完成 claim 的證明。**

錢包選單目前支援**同一瀏覽器中已安裝的錢包擴充套件**。尚未加入 WalletConnect QR code 或手機遠端連接，亦沒有錢包登入簽名。錢包連接只授權網站查看公開地址及讀取測試網資料。

## 測試代幣合約範本

`contracts/UCURRTest.sol` 是可 mint 的 capped ERC-20；`contracts/TCURRTest.sol` 是整數單位、收發地址均需 allowlist 的 restricted ERC-20。兩者只供 Sepolia 技術測試。tCURR 合約**不賦予法律上的股東權益**，不表示已完成證券合規設計。

```bash
npm run contracts:compile
```

編譯命令只在記憶體中檢查合約；不會部署、鑄造或寫入區塊鏈。若錢包目前沒有 tCURR，須由現有合約的有權地址鑄造或轉入；Portal 不會自行發行 token。正式部署前須先有安全審計、角色／金鑰管理、發行條款、合規與主管批准。Solana SPL mint 及跨鏈橋未實作。

## 驗證

```bash
npm test
npm run typecheck
npm run contracts:compile
npm run build
```

`tests/airdrop.test.mjs` 覆蓋比例分配、pool rounding、資格排除、重複地址與 claim 查找。實際 tCURR 餘額讀取需要已部署的 Sepolia 合約及測試 wallet；在合約地址提供前，無法完成鏈上實測。實際 wallet 擴充套件、Devnet RPC 及付款 provider 沒有自動化整合測試。

## 品牌與部署

- 品牌名稱、標語及 token 名稱集中在 `lib/brand.ts`；配色與視覺樣式在 `app/globals.css`。產品文案應同步檢查，不應只改 logo。
- Portal 已設 `robots: noindex`、關閉 `X-Powered-By`，並加入基本安全回應 headers。
- 只在受控測試環境部署。**不要公開當作正式交易、KYC、股東持倉或管理員系統**；Admin simulator 任何訪客均可改自己的本機資料。
- 不要加入真實卡號欄位或 payment capture；接駁支付服務前須設計後端訂單、供應商 webhook 驗證及防重處理。
- 正式版本需要伺服器資料庫、身份與權限管理、合規 KYC provider、鏈上資產來源、claim contract/服務、審計和監控。部署與真正空投機制均需獨立決策。

## 待主管決定的空投事項

正式資格來源與 record date、tCURR 持倉口徑、每人／每地址上限、不同鏈如何合併身份、排除條件、claim window、未領取額處理、鏈上或鏈下分配方式、法規與稅務流程。目前的比例公式與 10,000 uCURR pool **僅用於演示**。
