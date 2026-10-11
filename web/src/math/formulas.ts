export const potOdds = (pot:number, toCall:number): number => {
    return toCall / (pot + toCall);
}
export const equity = (win:number, tie:number, numPlayersInTie:number): number => {
    return win + tie / numPlayersInTie;
}
export const evCall = (equity:number, pot:number, toCall:number): number => {
    return equity * pot - (1 - equity) * toCall;
}
export const evBet = (pot:number, bet:number, foldFrequency:number, equityWhenCalled:number): number => {
    return foldFrequency * pot + (1 - foldFrequency) * (equityWhenCalled * (pot + 2 * bet) - bet);
}
export const bluffBreakEven = (pot:number, bet:number): number => {
    return bet / (pot + bet);
}
// pot here is the pot BEFORE the bet (unlike potOdds, where it includes the bet)
export const mdf = (pot:number, bet:number): number => {
    return pot / (pot + bet);
}
export const impliedOdds = (pot:number, toCall:number, equity:number): number | null => {
    if (equity === 0) {
        return null;
    }
    return toCall / equity - (pot + toCall);
}
export const choose = (n:number, k:number): number => {
    if (k < 0 || k > n) {
        return 0;
    }
    if (k === 0 || k === n) {
        return 1;
    }
    k = Math.min(k, n - k); // Take advantage of symmetry
    let c = 1;
    for (let i = 0; i < k; i++) {
        c = c * (n - i) / (i + 1);
    }
    return c;
}
export const outs = (numOuts:number, numCardsToCome:number): number => {
    if (numCardsToCome === 1) {
        return numOuts / 46; // 52 - 2 hole cards - 4 board cards
    } else if (numCardsToCome === 2) {
        return 1 - choose(47 - numOuts, 2) / choose(47, 2); // 47 unseen on the flop
    }
    throw new Error("Only supports 1 or 2 cards to come");
}
export const spr = (effectiveStack:number, pot:number): number => {
    return effectiveStack / pot;
}
export const pairCombos = (numUnseenOfRank:number): number => {
    return choose(numUnseenOfRank, 2);
}
export const unpairedCombos = (numUnseenRank1:number, numUnseenRank2:number): number => {
    return numUnseenRank1 * numUnseenRank2;
}
