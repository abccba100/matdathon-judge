# AGENTS.md

## 에이전트 구성 (Microsoft Agent Framework)

| 에이전트 | 역할 | 도구 |
|---|---|---|
| SummarizerAgent | 커밋/이슈 diff 요약 | `get_recent_commits`, `get_open_prs` |
| PlannerAgent | 다음 액션 3개 제안 | `get_calendar_slots`, `get_focus_history` |
| CriticAgent | 제안 검증 및 반려 | 없음 (검증 전용) |

## 오케스트레이션
`SequentialOrchestration`으로 Summarizer → Planner → Critic 순 실행.
Critic이 반려하면 Planner를 최대 2회 재시도한다.

## 컨텍스트 처리
- 세션별 `AgentThread`를 Cosmos DB에 영속화
- 토큰 예산 초과 시 오래된 턴부터 요약 압축

## 스트리밍
Copilot SDK의 스트리밍 응답을 SSE로 프론트엔드에 중계한다.

## 안전장치
- 도구 호출은 화이트리스트 기반, 쓰기 작업은 사용자 확인 필수
- 모든 AI 생성 결과에 출처 배지 표시
