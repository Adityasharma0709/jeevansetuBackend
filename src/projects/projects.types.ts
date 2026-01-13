export interface CreateProjectDTO {
  projectCode: string;
  name: string;
  description?: string;
}

export interface UpdateProjectDTO {
  name?: string;
  description?: string;
  status?: "ACTIVE" | "INACTIVE";
}
