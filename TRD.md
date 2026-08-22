# FocusFlow — TRD

## 아키텍처
- Frontend: React 19 + Vite, Azure Static Web Apps 배포
- Backend: .NET 9 Minimal API, Azure Container Apps (min 1 / max 5 replica)
- Data: Azure Cosmos DB (serverless), Azure Key Vault로 비밀 관리

## AI 계층
- GitHub Copilot SDK로 모델 연결, 응답은 SSE 스트리밍
- Microsoft Agent Framework로 3개 에이전트 오케스트레이션
  - SummarizerAgent: 커밋/이슈 요약
  - PlannerAgent: 다음 액션 제안
  - CriticAgent: 제안 검증 후 반려
- 도구 호출: get_open_prs, get_recent_commits, get_calendar_slots

## 배포 및 관찰 가능성
- Bicep IaC + GitHub Actions OIDC 인증(시크릿 없음)
- Application Insights 분산 추적, 실패율 알림 규칙

## 보안
- Managed Identity로 Cosmos/Key Vault 접근
- AI 생성 결과에 배지 표시, 파괴적 작업 전 사용자 확인
