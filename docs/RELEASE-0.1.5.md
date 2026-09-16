# Nagneon 0.1.5 · 로컬 모델 검증과 운영 도구

## 변경 이유와 사용자 안내

추천 경량 모델을 실제 머신에 구성하고 시험한 결과를 릴리즈 문서에 기록했다. 사용자 요청에 따라 앱 안에는 실측 제한이나 AI 작업 기록을 표시하지 않는다. 재현용 전체 관객/짧은 worker 시험 도구와 루프백 Ollama 실행 도구를 제공한다.

**RTX 2070 8GB 환경에서 시험한 추천 모델은 만족할 만한 성능과 응답 품질을 보이지 않았다.** Qwen3.5 0.8B는 현재 앱의 전체 입력에서 지연·미완료·문맥 오류가 있었고, 진단용 no-think 조건의 5개 상황에서도 유의미한 채팅 응답은 0/5였다. Gemma 3 1B와 Qwen2.5 1.5B는 전체 입력의 보수적 문맥 예산 검사에서 막혔다. 짧은 worker 실험에서는 일부 응답이 가능했지만 전체 서비스 대체 성공은 아니다. 모든 RTX 2070/로컬 모델 조합에 대한 일반화가 아니다.

- 기본 제공처와 기존 모델 선택을 유지한다. 로컬 모델로 자동 전환하지 않는다.
- LLM 가중치와 Ollama 런타임은 앱 ZIP에 포함하지 않는다. 설치는 선택 사항이며 유료 API는 추가하지 않았다.
- 음성 인식의 GPU/CPU 선택 설명도 이전 main의 개선을 포함한다. 음성/소리 선택 구성은 기존 고정 런타임 자산을 재사용한다.
- 저장 스키마·인증·추론 동작은 0.1.4와 동일하다. 데이터 백업 후 기존 저장 위치로 업데이트한다.
- 0.1.4로 복귀할 때 현재 기록을 덮어쓰지 않는다. 보존된 이전 설치본과 별도 백업 복사본으로 검증한다. 0.1.3 이하에 새 프로필을 직접 연결하지 않는다.

상세 표본·원본·한계는 [로컬 LLM 실측](LOCAL-LLM-VALIDATION-20260916.md)에 있다. 품질 비교는 설치본 안전성 검증과 분리한다.

## 배포 검증 상태

최종 패키지는 앱 내 실측 안내를 제거한 소스로 다시 빌드한다. 아래는 이전 후보의 검증 기록이며 파일 크기/해시는 최종 배포본을 뜻하지 않는다. 최종 검증·공개·적용은 다음 절에 따로 기록한다.

- 제품 원본 `e691c7f`, squash 통합 `2f136f56a5c9d5bf8c0ce2a249678534e2414d33`. 이 뒤 기록 갱신은 패키지 제품 소스를 변경하지 않는다.
- 작업·통합 필수 검사 676 tests/format/TypeScript/Vite 및 통합 SHA의 Windows·보안 CI 통과. 통합 최초 검사의 `audience-autonomy.test.js` HTTP fetch failed 1건은 보존했고, 해당 파일과 전체 재실행은 통과했다. 간헐 HTTP 실패 원인은 이번 UI 변경으로 해결됐다고 주장하지 않는다.
- 새 ASAR와 포함 소스 101개, 전체 배포 파일 89개/844,311,265 B, ASAR 보호/실행 fuse 검사 통과.
- 이전 음성 런타임 증거 재사용은 소스 불일치로 거절됐다. 새 전달 모듈과 격리 구성 캐시로 실제 GPU int8_float16/fallback=false, 합성 한국어 전사 1,357ms, 시스템 소리 처리 및 정상 워커 종료를 새로 검증했다. 물리 장치·실제 게임 시험은 아니다.
- 별도 설치 루트에서 실제 0.1.4의 시험 제목/공통 기억 저장 → 0.1.5 설치 → 기록 보존/리허설 시작·종료/정상 종료 → 재시작/보존 통과. 현재 데이터 복사본을 0.1.4로 열어 복귀 가능성을 확인했다. 원본 새 프로필은 유지했다.
- 실제 0.1.5 창에서 Ollama 선택의 새 RTX 2070 안내와 전체 문구/스크롤을 확인하고 정상 종료했다.
- 앱 ZIP: 304,515,437 B, SHA-256 `89c5c017888bdb19d5eae3a6d1cec7a5cbb80855b88e306707417913f53c234e`.
- 설치 도구 ZIP: 12,960 B, SHA-256 `9e85f1d5d8cf7d1245547894b3ed9e7e6cb3c96da5237336ce6ffab804bcf166`.
- ZIP 89개 항목을 원본 파일 길이·해시와 대조했다. 최초 로컬 ZIP 보조 스크립트의 PowerShell 5.1 UTF-8 읽기/압축 어셈블리 누락 오류는 수정 후 다시 생성·검증했다. 게시된 자산을 덮어쓴 것은 아니다.

원본은 `local-llm` worktree의 `artifacts/release-check.log`, `packaged-runtime-test.json`, `integrity-015-final.log`, `install-baseline.log`, `install-update.log`, `ui-baseline.log`, `ui-updated.log`, `ui-restart.log`, `ui-rollback.log`, `native-guidance-015.json`, `release-015-assets.json`과 `local-llm-integration/release-check.log`, `release-focused-check.log`, `release-recheck.log`에 보존한다. 모델 성능 미달은 알려진 제한이며 자동 로컬 전환은 없다.

## 최종 패키지와 사용자 적용

- 사용자 요청을 반영한 원본 `82603be`, 통합 `39ad652`: 실측·AI 작업 문구를 앱에서 제거했다. 최종 JS 번들에도 해당 문구가 없으며 포함 소스 101개/파일 89개 무결성이 일치한다. 새 앱 설치 크기는 844,310,384 B다.
- 최종 작업·통합 필수 검사 676/676·빌드와 통합 SHA의 Windows/보안 CI 통과. `release-final-check.log`를 각각 보존했다.
- 새 패키지: `release/2026-09-16T11-53-10-510Z`. 앱 ZIP 304,515,107 B / SHA-256 `2b9433caf35f753aab344ab6dc14f05cfa2bb3b7ec964fe43c05d48da6d46f80`. 도구 ZIP 12,984 B / SHA-256 `5ca272023201fe92aab90531aed46b457b9e4b6765ab37b2d6c329e25a190fca`. 89개 ZIP 항목을 다시 검증했다.
- 실제 설치 0.1.4 → 최종 0.1.5 업데이트·시험 제목/기억 보존·리허설/정상 종료를 재검증했다. 음성·소리·계정 어댑터 및 런타임 23개 비교에서 변경 0건을 확인해 같은 작업에서 성공한 실제 GPU 런타임 증거를 재사용했다. 안내 UI 제거가 그 증거를 무효화하지 않는다.
- 사용자 안정 설치를 `versions/0.1.5-20260916-205721-6ac0632c`로 적용했다. 백업은 설치 루트의 `backups/update-20260916-205721-6ac0632c`다. 설치 중 기존 데이터 337개 해시가 모두 유지됐다. 실제 앱 시작·정상 종료·재시작 후 원본 현재 기록은 같고 순환 백업 `world.json.bak.1/2/3`만 갱신됐다. 기본 제공처/계정/저장 위치는 유지한다.
- 실제 사용자 프로필로 방송실 정상 렌더링·STANDBY를 확인했다. 화면·마이크·방송을 시작하지 않았으며 앱 내 실측 안내는 없다. 최종 앱은 일반 실행 상태로 남긴다.
- 최종 증거: `artifacts/integrity-015-release.log`, `final-install-old.log`, `final-install-update.log`, `final-ui-update.log`, `zip-015-release.log`, `user-install-015.log`, `user-install-preservation.json`, `user-after-launch-preservation.json`, `user-native-015.json`, `user-restart-015.json`. 이전 후보 자산은 `release-015-candidate-assets.json`으로 구분한다.

정식 배포는 위 최종 파일만 사용한다. 설치·실행 검증과 RTX 2070 모델 품질 미달은 별개이며, 알려진 출시 차단 결함은 없다. 배포 자산은 기존 태그·파일을 덮어쓰지 않고 v0.1.5에 게시한다.
