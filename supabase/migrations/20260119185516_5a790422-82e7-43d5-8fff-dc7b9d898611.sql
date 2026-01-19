-- Create profiles table for user information
CREATE TABLE public.profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create templates table for storing Canva templates
CREATE TABLE public.templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  width INTEGER NOT NULL DEFAULT 1080,
  height INTEGER NOT NULL DEFAULT 1920,
  green_area_x INTEGER,
  green_area_y INTEGER,
  green_area_width INTEGER,
  green_area_height INTEGER,
  is_favorite BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create processing_jobs table for batch video processing
CREATE TABLE public.processing_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  template_id UUID REFERENCES public.templates(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  total_videos INTEGER NOT NULL DEFAULT 0,
  processed_videos INTEGER NOT NULL DEFAULT 0,
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create job_videos table for individual videos in a job
CREATE TABLE public.job_videos (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES public.processing_jobs(id) ON DELETE CASCADE,
  original_name TEXT NOT NULL,
  storage_path TEXT,
  output_path TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  error_message TEXT,
  duration_seconds NUMERIC,
  original_width INTEGER,
  original_height INTEGER,
  progress INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processing_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_videos ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Users can view their own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = user_id);

-- Templates policies
CREATE POLICY "Users can view their own templates"
  ON public.templates FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own templates"
  ON public.templates FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own templates"
  ON public.templates FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own templates"
  ON public.templates FOR DELETE
  USING (auth.uid() = user_id);

-- Processing jobs policies
CREATE POLICY "Users can view their own jobs"
  ON public.processing_jobs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own jobs"
  ON public.processing_jobs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own jobs"
  ON public.processing_jobs FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own jobs"
  ON public.processing_jobs FOR DELETE
  USING (auth.uid() = user_id);

-- Job videos policies (users can access videos from their jobs)
CREATE POLICY "Users can view videos from their jobs"
  ON public.job_videos FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.processing_jobs
      WHERE processing_jobs.id = job_videos.job_id
      AND processing_jobs.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert videos to their jobs"
  ON public.job_videos FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.processing_jobs
      WHERE processing_jobs.id = job_videos.job_id
      AND processing_jobs.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update videos in their jobs"
  ON public.job_videos FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.processing_jobs
      WHERE processing_jobs.id = job_videos.job_id
      AND processing_jobs.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete videos from their jobs"
  ON public.job_videos FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.processing_jobs
      WHERE processing_jobs.id = job_videos.job_id
      AND processing_jobs.user_id = auth.uid()
    )
  );

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create triggers for automatic timestamp updates
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_templates_updated_at
  BEFORE UPDATE ON public.templates
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_processing_jobs_updated_at
  BEFORE UPDATE ON public.processing_jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_job_videos_updated_at
  BEFORE UPDATE ON public.job_videos
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create function to auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email, full_name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'full_name');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create trigger on auth.users for auto profile creation
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Create storage bucket for templates
INSERT INTO storage.buckets (id, name, public)
VALUES ('templates', 'templates', true);

-- Create storage bucket for videos (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('videos', 'videos', false);

-- Create storage bucket for processed outputs
INSERT INTO storage.buckets (id, name, public)
VALUES ('outputs', 'outputs', false);

-- Storage policies for templates bucket
CREATE POLICY "Users can view their own templates files"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'templates' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can upload their own templates files"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'templates' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can update their own templates files"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'templates' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete their own templates files"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'templates' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Storage policies for videos bucket
CREATE POLICY "Users can view their own video files"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'videos' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can upload their own video files"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'videos' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete their own video files"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'videos' AND auth.uid()::text = (storage.foldername(name))[1]);

-- Storage policies for outputs bucket
CREATE POLICY "Users can view their own output files"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'outputs' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can upload their own output files"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'outputs' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete their own output files"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'outputs' AND auth.uid()::text = (storage.foldername(name))[1]);