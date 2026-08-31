






























export interface RefreshProgress {
  
  hot: number;
  
  cold: number;
  
  coldDone: number;
  
  failedAcc: string[];
  







  failedTotal?: number;
}






















export function advanceProgress(params: {
  prev: RefreshProgress;
  inHotPhase: boolean;
  hotSlice: number;
  baseSliceLen: number;
  coldListLen: number;
}): { next: RefreshProgress; wrapped: boolean } {
  const { prev, inHotPhase, hotSlice, baseSliceLen, coldListLen } = params;
  const len = Math.max(1, coldListLen);
  if (inHotPhase) {
    return {
      next: { hot: prev.hot + hotSlice, cold: prev.cold, coldDone: prev.coldDone, failedAcc: prev.failedAcc, failedTotal: prev.failedTotal },
      wrapped: false,
    };
  }
  const cold = (prev.cold + baseSliceLen) % len;
  return {
    next: { hot: prev.hot, cold, coldDone: prev.coldDone + 1, failedAcc: prev.failedAcc, failedTotal: prev.failedTotal },
    
    
    wrapped: baseSliceLen > 0 && cold < prev.cold,
  };
}


export function isPassDone(p: RefreshProgress, hotListLen: number, coldSlicesPerPass: number): boolean {
  return p.hot >= hotListLen && p.coldDone >= coldSlicesPerPass;
}
