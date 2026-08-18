/** UniversalRouter.execute — payable V4_SWAP entrypoint. */
export const universalRouterAbi = [
  {
    type: 'function',
    name: 'execute',
    stateMutability: 'payable',
    inputs: [
      { name: 'commands', type: 'bytes' },
      { name: 'inputs', type: 'bytes[]' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [],
  },
  { type: 'error', name: 'ExecutionFailed', inputs: [{ name: 'commandIndex', type: 'uint256' }, { name: 'message', type: 'bytes' }] },
  { type: 'error', name: 'BalanceTooLow', inputs: [] },
  { type: 'error', name: 'ContractLocked', inputs: [] },
  { type: 'error', name: 'ETHNotAccepted', inputs: [] },
  { type: 'error', name: 'FromAddressIsNotOwner', inputs: [] },
  { type: 'error', name: 'InputLengthMismatch', inputs: [] },
  { type: 'error', name: 'InsufficientETH', inputs: [] },
  { type: 'error', name: 'InsufficientToken', inputs: [] },
  { type: 'error', name: 'InvalidBips', inputs: [] },
  { type: 'error', name: 'InvalidCommandType', inputs: [{ name: 'commandType', type: 'uint256' }] },
  { type: 'error', name: 'InvalidEthSender', inputs: [] },
  { type: 'error', name: 'LengthMismatch', inputs: [] },
  { type: 'error', name: 'TransactionDeadlinePassed', inputs: [] },
  { type: 'error', name: 'UnsupportedCommandType', inputs: [{ name: 'commandType', type: 'uint256' }] },
] as const
