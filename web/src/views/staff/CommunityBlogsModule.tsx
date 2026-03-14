import type { User } from "firebase/auth";

import type { FunctionsClient } from "../../api/functionsClient";
import CommunityBlogStudio from "../community/CommunityBlogStudio";

type Props = {
  client: FunctionsClient;
  user: User;
  active: boolean;
};

export default function CommunityBlogsModule({ client, user, active }: Props) {
  return (
    <CommunityBlogStudio
      client={client}
      user={user}
      active={active}
      variant="staff"
    />
  );
}
