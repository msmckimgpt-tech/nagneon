// Conservative request recognition. Mentioning a hint or being stuck is not
// permission to give one; model instructions still interpret the full speech.
export function requestsAdvice(speech='',mode='on-request'){
  if(mode==='never')return false;
  const text=String(speech).normalize('NFKC').toLowerCase()
    .replace(/"[^"\n]*"|“[^”\n]*”|‘[^’\n]*’|「[^」\n]*」|『[^』\n]*』/gu,'');
  let requested=false;
  for(const clause of text.split(/(?<=[.!?。！？\n])|(?<=말고)\s+|\s*(?:그런데|하지만|근데|대신)\s*/u)){
    const topic=/(?:훈수|힌트|공략|정답|도움|스포일러)/u.test(clause);
    const declined=(topic&&/(?:말고|말아|말자|싫|필요\s*없|하지|금지|그만|안\s*(?:해|줘|주)|사양)/u.test(clause))
      ||/(?:알려\s*주지|도와\s*주지|말하지)\s*(?:마|말)|(?:no|without|stop|don't|do not)\b.{0,30}\b(?:hints?|advice|help|backseating)\b/u.test(clause)
      ||(requested&&/(?:이제|지금은).{0,10}(?:필요\s*없|그만|괜찮)/u.test(clause));
    if(declined){requested=false;continue;}
    // Recounting an earlier request does not renew it.
    if(/(?:부탁|요청|알려\s*달라|도와\s*달라).{0,12}(?:했|했던|했었|하던|했더|했잖|고\s*말했)/u.test(clause))continue;
    if((topic&&/(?:부탁|(?:해|알려|가르쳐|찾아|검색해|설명해)\s*(?:줘|주|줄)|(?:하나|조금|좀|만)\s*(?:줘|주|줄)|듣고\s*싶|가능할까|해도\s*돼)/u.test(clause))
      ||/^\s*(?:훈수|힌트|공략)(?:\s*(?:좀|부탁))?[.!?\s]*$/u.test(clause)
      ||/도와\s*(?:줘|주세|주실|줄래|줄\s*수)|\b(?:help me|can you help|give me (?:a |some )?hints?)\b/u.test(clause)
      ||/^\s*help[!?.\s]*$/u.test(clause)
      ||/(?:어떻게|어디로|어디를|뭘|무엇을|어느\s*쪽|어떤\s*카드).{0,25}(?:해야|하면|풀|깨|이기|가야|골라|고르|선택|써야|눌러|누르면)/u.test(clause))requested=true;
  }
  return requested;
}
