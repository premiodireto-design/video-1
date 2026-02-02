import { Navigate } from 'react-router-dom';

const Index = () => {
  // Redirect to dashboard (which requires auth)
  return <Navigate to="/dashboard" replace />;
};

export default Index;
