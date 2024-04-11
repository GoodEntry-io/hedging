/**
 * Observe vaults positions and oracle price update to compute greeks.
 * Update on vault events and oracle updates
 * Serve greeks through a websocket
 * Uses Deribit to get the ETH DVOL, needs to be updated to get relevant volatility for other pairs
 *
 * Usage: node scripts/gev2_delta.js
 */
 
 
import greeks from "greeks";
import semaphore from "semaphore";
import axios from "axios";
import { Alchemy, Network, Contract,  Wallet } from "alchemy-sdk";
import { ethers } from "ethers";
import JSONdb from 'simple-json-db';
import * as fs from "fs"
import * as dotenv from 'dotenv/config'
import PositionManagerV2_ABI from "./abis/PositionManagerV2_ABI.json" assert { type: "json" }
import VaultV2_ABI from "./abis/VaultV2_ABI.json" assert { type: "json" }
import Oracle_ABI from "./abis/GoodEntryOracle.json" assert { type: "json" }
import addresses from "../addresses.json" assert { type: "json" }
import WebSocket, { WebSocketServer } from 'ws';


///////////////////////// PROCESS PARAMETERS /////////////////////////

const chainName = "arbitrum"
const chainAddresses = addresses[chainName]


///////////////////////// RPC AND WEB3 EVENTS /////////////////////////


const alchemyProvider = new ethers.providers.JsonRpcProvider("https://arb-mainnet.g.alchemy.com/v2/"+process.env.ALCHEMY_KEY);
const signer = new ethers.Wallet(process.env.LIQUIDATOR_PRIVATE_KEY, alchemyProvider);
const alchemySettings = {
  apiKey: process.env.ALCHEMY_KEY, // Replace with your Alchemy API key.
  network: Network.ARB_MAINNET, // Replace with your network.
};
const alchemy = new Alchemy(alchemySettings);


/// event OpenedPosition(address indexed user, bool indexed isCall, uint indexed strike, uint amount, uint tokenId);
const OPENED_POSITION_EVENT = "0x175bafc5525b745c29ea48097e504eca988c84edcc1bf503fa5866115854d4b5"
/// event ClosedPosition (index_topic_1 address user, address closer, uint256 tokenId, int256 pnl)
const CLOSED_POSITION_EVENT = "0xc6ec1e16b7b639fb4e5dfccd3a9134b7190008e32a93758705a829394bae907a"

/// event   event NewTransmission(uint32 indexed aggregatorRoundId,int192 answer,address transmitter,int192[] observations,bytes observers,bytes32 rawReportContext);
/// emitted when the oracle aggregator updates the token price
const ORACLE_NEW_TRANSMISSION = "0xf6a97944f31ea060dfde0566e4167c1a1082551e64b60ecb14d599a9d023d451"


const topics = {
  [OPENED_POSITION_EVENT]:   { types: ['uint256', 'uint256'], label: "OpenedPosition" },
  [CLOSED_POSITION_EVENT]:   { types: ['address', 'uint256', 'uint256'], label: "ClosedPosition" },
  [ORACLE_NEW_TRANSMISSION]: { types: ['int192', 'address', 'int192[]', 'bytes', 'bytes32'], label: "NewTransmission"},
}
const filter = {
  topics: [Object.keys(topics)]
};



///////////////////////// GLOBAL VARS  /////////////////////////

// View of the vault: reserves, options written
var vaultViews = {}


// WS server
const wss = new WebSocketServer({ port: (process.env.DELTA_WS_PORT || 3000) });

wss.on('connection', function connection(ws) {
  ws.on('error', console.error);
  ws.send(objectifyDeltas());
});


///////////////////////// FUNCTIONS /////////////////////////

/// Nice looking logs
const prettyLog = (...args) => { console.log("[date]".replace("date", new Date().toLocaleString()), ...args); }



// Return vault matching the given address
const getVault = (address) => {
  for (let v of chainAddresses.vaults)
    if (v.address.toLowerCase() == address.toLowerCase()
      || v.pm.toLowerCase() == address.toLowerCase()
      || v.oracleAggregatorAddresses.toLowerCase() == address.toLowerCase()
    )
      return v
  return {}
}



const createVaultView = async (vault) => {
  prettyLog("Building vault view", vault.name)
  let vaultView = { baseAmount: 0, quoteAmount: 0, positions: {}, price: 1, delta: 0 }
  const vaultContract = new Contract(vault.address, VaultV2_ABI,            alchemyProvider)
  const pmContract =    new Contract(vault.pm,      PositionManagerV2_ABI,  alchemyProvider)
  const oracleContract =new Contract(chainAddresses.oracle, Oracle_ABI,     alchemyProvider)
  try{
    const price = await oracleContract.getAssetPrice(chainAddresses.tokens[vault.name.split('-')[0]])
    vaultView.price = price / 1e8
    
    const reserves = await vaultContract.getReserves()
    vaultView.baseAmount = reserves.baseAmount.toString()
    vaultView.quoteAmount = reserves.quoteAmount.toString()
    
    let nftSupply = await pmContract.totalSupply()
    prettyLog("Checking existing positions ("+nftSupply.toString()+")")
    for (let k = 0; k< nftSupply; k++){
      let positionId = await pmContract.tokenByIndex(k);
      let position = await pmContract.getPosition(positionId)
      vaultView.positions[positionId] = position
    }
    //prettyLog(vaultView)
    calculateGreeks(vault)
  }
  catch(e) {
    prettyLog(e)
  }
  vaultViews[vault.name] = vaultView
}



const openedPosition = async (log) => {
  let vault = getVault(log.address)
  if (!vault.address) return;
  try {
    const pmContract = new Contract(vault.pm, PositionManagerV2_ABI, alchemyProvider)
    const data = ethers.utils.defaultAbiCoder.decode(topics[log.topics[0]].types, log.data);
    const positionId = data[1];
    const position = await pmContract.getPosition(positionId)
    let size = position.isCall ? 
      (position.notionalAmount.toString() / 10**vault.baseDecimals).toFixed(6) 
      : position.notionalAmount.toString() / 10**vault.quoteDecimals

    prettyLog("New position", positionId.toString(), ":", (position.isCall ? "C-" : "P-")+position.strike.toString()/1e8, "size:", size)
    vaultViews[vault.name].positions[positionId] = position
    await calculateGreeks(vault)
  }
  catch(e) {
    prettyLog("Opened pos", e)
  }
}



const closedPosition = async (log) => {
  let vault = getVault(log.address)
  if (!vault.address) return;
  try {
    if (log.address.toLowerCase() != vault.pm.toLowerCase()) return;
    const data = ethers.utils.defaultAbiCoder.decode(topics[log.topics[0]].types, log.data);
    const positionId = data[1].toString()
    prettyLog("Closed position", positionId, vault.name)
    delete vaultViews[vault.name].positions[positionId]
    await calculateGreeks(vault)
  }
  catch(e) {
    prettyLog("Clsed pos", e)
  }
}


const handleNewPrice = async (log) => {
  const data = ethers.utils.defaultAbiCoder.decode(topics[log.topics[0]].types, log.data);
  let price = data[0].toString() / 1e8
  
    // need to update all the vaults with the new price
  for (let vault of chainAddresses.vaults){
    if (vault.oracleAggregatorAddresses.toLowerCase() == log.address.toLowerCase()){
      vaultViews[vault.name].price = price
      prettyLog("Oracle observation, price:", price, vault.name)
      await calculateGreeks(vault)
    }
  }
  
}



const getVol = async () => {
  try {
    const data = (await axios.get("https://test.deribit.com/api/v2/public/get_historical_volatility?currency=ETH")).data
    const vol = data.result[data.result.length-1]
    return vol[1] / 100
  }
  catch(e){
    prettyLog("GetVol", e)
  }
}



const calculateGreeks = async (vault) => {
  let delta = 0 //vault.baseAmount / 1 ** vault.baseDecimals || 0;
  const tteInYears = 1 / 365 / 6 // currently using 4h tte
  let vol = await getVol()
  let rfr = 0.04
  console.log('Calc greeks')
  console.log(vaultViews[vault.name].positions)
  for (let pos of Object.values(vaultViews[vault.name].positions)){
    //getDelta(price, strike, tte, vol, rfr, "call/put")
    let baseDelta = greeks.getDelta(vaultViews[vault.name].price, pos.strike / 1e8, tteInYears, vol, rfr, pos.isCall ? "call" : "put")
    if (pos.isCall) delta += baseDelta * pos.notionalAmount / 10**vault.baseDecimals
    else delta += baseDelta * pos.notionalAmount / 10**vault.quoteDecimals / vaultViews[vault.name].price
    
    vaultViews[vault.name].delta = delta
  }
  prettyLog("Vault "+vault.name+" Delta @"+vaultViews[vault.name].price, ":", delta)
  
  broadcastDeltas()
}



const objectifyDeltas = () => {
  var deltas = Object.keys(vaultViews).map(k => {return {vault: k, delta: vaultViews[k].delta, price: vaultViews[k].price}})
  return JSON.stringify({time: new Date().getTime(), deltas: deltas})
  
}



const broadcastDeltas = async () => {
  const deltas = objectifyDeltas()
  wss.clients.forEach(function each(client) {
    try {
      if (client.readyState === WebSocket.OPEN) client.send(deltas)
    } catch(e){
      console.log('Broadcast', e)
    }  
  });
}




const main = async () => {
  // when running first, need to pull the whole vault data to create a local view of the vault
  for (let vault of chainAddresses.vaults)
    await createVaultView(vault)
  
  // listen to oracle events to update greeks
  alchemy.ws.on(filter, (log, event) => {
    if (log.topics[0] == ORACLE_NEW_TRANSMISSION) handleNewPrice(log)
    else if (log.topics[0] == OPENED_POSITION_EVENT) openedPosition(log)
    else if (log.topics[0] == CLOSED_POSITION_EVENT) closedPosition(log)
  });
}
main()