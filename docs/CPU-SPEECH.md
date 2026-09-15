# CPU 마이크 인식 검증

CRITICAL-REVIEW 5-7의 “GPU를 요구한다”는 표현은 필수 조건과 기본 선택을 혼동한다. 설정에는 GPU/CPU 선택이 있으며 GPU 불가 시 CPU 폴백도 있다. 기존 사용자의 선택과 GPU 기본값을 변경하지 않았다.

2026-09-16 공개0.1.4의 실제 전달 ASAR와 공개 다운로드로 설치한 medium 모델/Python을 사용했다. 개발 PATH를 제외하고 GPU 라이브러리 경로는 존재하지 않는 디렉터리로 지정했으며 장치는 CPU를 명시했다. 결과는 CPU / int8, fallback=false, 준비4,319ms, 보관된 합성 한국어 입력 전사1,997ms로 통과했다. 같은 실행에서 시스템 소리/대사 인식도 통과했다. Intel Core i7-9700K(8코어/8스레드)에서 수행한 단일 기능 검증이며 물리 마이크, GPU 없는 다른 PC, 동시 게임 FPS, 지속 부하나 모든 발화의 정확도 측정은 아니다.

검증기는 `scripts/verify-packaged-runtime.mjs --speech-device=cpu --expect-speech-device=cpu`다. 원본 `artifacts/critical-review/cpu-speech-acceptance.json`과 `.log`. CPU 선택 시 구성 관리자가 GPU 팩을 요청하지 않는 회귀는 runtime-components 테스트에 있다. 사용자가 GPU/CPU의 자원·지연 차이를 판단할 수 있도록 설정 설명을 보강했다. 설명 추가는0.1.4 이후 소스 변경이며 게시된 앱에 소급 적용된 것으로 표시하지 않는다.
