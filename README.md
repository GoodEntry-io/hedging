# GoodEntry hedging

Various scripts for hedging LP exposure.

## Greeks / delta

Listen to vault related events and price oracle updates to compute accurate greeks.

`node scripts/gev2_delta.js`

## User position and vault tracker example script (Python)
```
script/brownieGetPosition.py
```

This is a Python script that runs in the Eth-Brownie framework for interacting with smart contracts, and retrieves open positions and a specified user exposure data from the GoodEntry protocol on the Arbitrum network. 

### Prerequisites

Before running the script, make sure you have the following prerequisites installed:

- Python 3.8
- Brownie (version 1.19.3)

### Installation

1. Clone the repository:

```
git clone https://github.com/goodentry-io/hedging.git
cd hedging
```

2. (Optional) Start a clean docker environment with the recommended Python version

```
docker run -it --rm -v $(pwd):/tmp/code -w /tmp/code python:3.8 bash
```

3. Install Brownie:

```
pip install eth-brownie==1.19.3
```

## Usage

To run the script and retrieve the open positions and user exposure data, execute the following command:

```
brownie run scripts/brownieGetPosition.py --network arbitrum-main
```

The script will connect to the Arbitrum network, interact with the GoodEntry smart contracts, and display the open positions and user exposure data.

### Output

The script will output two sections:

1. User Exposure: This section displays the user's exposure data, including reserves, balances, and proportions.

2. Open Positions: This section displays the details of each open position, including the position type, strike price, notional value, collateral value, expiry, and more.

### Disclaimer

Please note that this script is provided as-is and should be used at your own risk. Make sure to review and understand the code before running it. The authors and contributors of this project are not responsible for any financial losses or damages incurred while using this script.

