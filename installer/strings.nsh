; installer/strings.nsh
; ---------------------------------------------------------------------------
; User-facing strings for the Nagneon installer.
;
; Korean is the primary UI language; English is provided as a fallback so the
; installer remains usable on non-Korean Windows. This file MUST be !included
; AFTER the `!insertmacro MUI_LANGUAGE` lines, because LangString entries bind
; to language ids created by those macros. All $(...) references live in
; Sections/Functions, which are defined later, so ordering is safe.
;
; None of these strings claim the build is signed, retail-ready, or reviewed
; by Steam. The development / unsigned status is stated up front.
; ---------------------------------------------------------------------------

; One-time notice shown before the wizard: honest about what this build is.
LangString MsgDevNotice        ${LANG_KOREAN}  "이 설치 프로그램은 개발용(미서명) 빌드입니다.$\n관리자 권한 없이 현재 사용자 계정에만 설치되며,$\n설치 위치는 %LOCALAPPDATA%\Programs 입니다.$\n게시자 정보는 실제 게시자가 지정될 때까지 개발용으로 표시됩니다."
LangString MsgDevNotice        ${LANG_ENGLISH} "This is a development (unsigned) build.$\nIt installs for the current user only, without elevation,$\nunder %LOCALAPPDATA%\Programs.$\nThe publisher stays a development marker until a real publisher is configured."

; Same version+build already present: we do not overwrite an immutable payload.
LangString MsgAlreadyInstalled ${LANG_KOREAN}  "이 버전은 이미 설치되어 있습니다. 바로가기와 정보만 새로 고칩니다.$\n기존 파일은 변경하지 않습니다."
LangString MsgAlreadyInstalled ${LANG_ENGLISH} "This exact version is already installed. Only the shortcut and registry info will be refreshed.$\nExisting files are left unchanged."

; Leftover staging dir from an interrupted attempt: never auto-deleted.
LangString MsgStaleStaging     ${LANG_KOREAN}  "이전 설치 시도의 임시 폴더가 남아 있습니다:$\n$StageDir$\n$\n안전을 위해 자동으로 삭제하지 않습니다. 폴더를 직접 확인해 정리한 뒤 다시 실행하세요."
LangString MsgStaleStaging     ${LANG_ENGLISH} "A staging folder from a previous, interrupted attempt exists:$\n$StageDir$\n$\nIt is not deleted automatically. Review and remove it manually, then run the installer again."

; Extraction did not finish: do NOT publish shortcuts/registry; running version untouched.
LangString MsgExtractIncomplete ${LANG_KOREAN} "설치 파일 추출이 완료되지 않았습니다. 바로가기와 등록 정보를 만들지 않았습니다.$\n기존에 설치된 버전은 그대로 유지됩니다."
LangString MsgExtractIncomplete ${LANG_ENGLISH} "File extraction did not complete. No shortcut or registry info was published.$\nAny previously installed version is left intact."

; Promote (staging -> versioned payload) failed.
LangString MsgPromoteFailed    ${LANG_KOREAN}  "새 버전 폴더로 전환하지 못했습니다. 설치를 취소했습니다.$\n기존 버전은 변경되지 않았습니다."
LangString MsgPromoteFailed    ${LANG_ENGLISH} "Could not switch to the new version folder. Installation was cancelled.$\nThe existing version was not modified."

; Uninstall found the app still running (files locked): never force-killed.
LangString MsgLeftOverRunning  ${LANG_KOREAN}  "앱이 실행 중이어서 일부 파일을 삭제하지 못했습니다.$\n강제로 종료하지 않았습니다. 앱과 방송을 닫은 뒤 제거를 다시 실행하세요.$\n사용자 데이터와 로그인 정보는 삭제되지 않습니다."
LangString MsgLeftOverRunning  ${LANG_ENGLISH} "The app appears to be running, so some files could not be removed.$\nNothing was force-killed. Close the app and any broadcast, then run uninstall again.$\nYour user data and login credentials are never removed."
