// Reference books data layer (teams, masters, labels, service deletes) —
// public surface. The hooks live in `./queries/` by entity; importers keep
// using this path.

export {
  teamCities,
  teamMembers,
  teamRoles,
  type City,
  type Master,
  type Team,
} from "./queries/types";
export {
  fetchTeams,
  useCreateFirstCalendar,
  useCreateTeam,
  useTeam,
  useTeams,
} from "./queries/teams";
export {
  fetchMasters,
  useCreateMaster,
  useMaster,
  useMasters,
} from "./queries/masters";
export {
  fetchCities,
  useCities,
  useCreateCity,
  usePurgeExpiredCities,
  useReorderCities,
} from "./queries/cities";
export {
  useDeleteCity,
  useDeleteMaster,
  useDeleteService,
  useUpdateCity,
  useUpdateMaster,
  useUpdateService,
  useUpdateTeam,
} from "./queries/ref-write";
export { usePurgeService, useServiceUsageCount } from "./queries/services";
export {
  useRemoveMasterFromTeams,
  useUpdateTeamMembers,
} from "./queries/team-members";
