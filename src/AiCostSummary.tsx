import type { AiPricing, AiUsage } from './ai-types';
import './ai-cost.css';

const currency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 4,
  maximumFractionDigits: 6,
});
const money = (value: number) =>
  value > 0 && value < 0.000001 ? '<$0.000001' : currency.format(value);
export function costRange(upper: number, uncertainty = 0) {
  return uncertainty > 1e-12
    ? `${money(Math.max(0, upper - uncertainty))} – ${money(upper)}`
    : money(upper);
}

export function AiCostSummary({ totals }: { totals: AiUsage }) {
  const hasApi = totals.priced > 0;
  const hasReference = totals.referencePriced > 0;
  const unpriced = Math.max(
    0,
    totals.calls - totals.priced - totals.referencePriced - totals.localCalls,
  );
  const openRates = () => {
    const details = document.getElementById('ai-cost-rates') as HTMLDetailsElement | null;
    if (details) {
      details.open = true;
      details.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  };
  return (
    <article className="panel ai-cost-summary" aria-label="AI 비용 요약">
      <small>
        {!hasApi && hasReference ? '구독 사용량의 API 단가 환산' : 'API 토큰 예상 비용'}
      </small>
      <strong className="ai-cost-value">
        {hasApi
          ? costRange(totals.estimatedUsd, totals.apiUncertaintyUsd)
          : hasReference
            ? costRange(totals.referenceUsd, totals.referenceUncertaintyUsd)
            : totals.calls === 0
              ? '$0.0000'
              : totals.localCalls === totals.calls
                ? '외부 API 사용 없음'
                : '산정 정보 필요'}
      </strong>
      {hasApi && <span>API {totals.priced}회 산정 · 표준 또는 설정 단가 기준</span>}
      {hasReference && (
        <span>
          {hasApi
            ? `구독 API 환산 ${costRange(totals.referenceUsd, totals.referenceUncertaintyUsd)} · `
            : ''}
          {totals.referencePriced}회 · 실제 청구액 아님
        </span>
      )}
      {totals.calls === 0 && <span>선택한 기간에 요청이 없습니다.</span>}
      {(totals.apiUncertaintyUsd > 0 || totals.referenceUncertaintyUsd > 0) && (
        <span>캐시 세부 사용량 미보고분은 금액 범위로 표시합니다.</span>
      )}
      {(unpriced > 0 || totals.localCalls > 0) && (
        <span>
          미산정 {unpriced}회 · 로컬 실행 {totals.localCalls}회 별도
        </span>
      )}
      <button className="secondary" onClick={openRates}>
        단가·계산 기준 보기
      </button>
    </article>
  );
}

const reasons: Record<string, string> = {
  'missing-rate': '단가 설정 필요',
  'missing-usage': '입력·출력 토큰 미보고',
  'invalid-usage': '토큰 세부값 확인 필요',
  unsupported: '별도 요금 체계',
  running: '응답 대기',
  local: '로컬 실행 · 기기 비용 별도',
};
export function AiRequestCost({
  pricing,
  legacyCost,
}: {
  pricing?: AiPricing;
  legacyCost: number | null;
}) {
  if (!pricing) return <span>{legacyCost === null ? '산정 정보 없음' : money(legacyCost)}</span>;
  if (pricing.usd === null) return <span>{reasons[pricing.reason] || '산정 정보 없음'}</span>;
  return (
    <>
      <span className="ai-request-cost">{costRange(pricing.usd, pricing.uncertaintyUsd)}</span>
      <small>
        {pricing.kind === 'reference' ? '구독 API 환산 · 청구액 아님' : 'API 토큰 예상 비용'}
      </small>
      <small>
        {pricing.source === 'official'
          ? `공식 표준 단가 · ${pricing.checkedAt}`
          : pricing.source === 'manual'
            ? '사용자 설정 단가'
            : '기존 산정액 보존'}
        {pricing.longContext ? ' · 장문 단가' : ''}
        {pricing.backfilled ? ' · 보관 기록 보완' : ''}
      </small>
    </>
  );
}
